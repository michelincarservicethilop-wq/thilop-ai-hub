"""Lõi của cổng AI: kiểm tra quyền, hạn mức, tốc độ → cache → router → gọi hãng (có dự phòng) → đo token → ghi nhật ký.

Mọi phần khác của Hub (Chat, Ứng dụng, Studio, Hộp thư, /v1) đều gọi AI qua file này.
"""
from __future__ import annotations

import copy
import logging
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

import litellm
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import AIModel
from . import cache as resp_cache
from .kv import kv
from .pricing import minute_cost_vnd, token_cost_vnd
from .principal import Principal
from .quota import QuotaExceeded, ensure_quota
from .router import candidates
from .settings_store import get_setting
from .usage import log_usage

log = logging.getLogger("hub.llm")
litellm.drop_params = True  # bỏ tham số model không hỗ trợ thay vì báo lỗi
litellm.suppress_debug_info = True

PASS_PARAMS = ("temperature", "top_p", "max_tokens", "max_completion_tokens", "stop", "tools", "tool_choice", "response_format", "seed", "reasoning_effort")


class GatewayError(Exception):
    def __init__(self, status_code: int, message: str, code: str = "gateway_error") -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.code = code


@dataclass
class ChatResult:
    content: str
    model_used: str
    task: str
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0
    cost_vnd: Decimal = Decimal("0")
    cache_hit: bool = False
    raw: dict[str, Any] = field(default_factory=dict)


# ---------------- tiện ích ----------------
def _api_key_for(provider_model: str) -> str | None:
    s = get_settings()
    prefix = provider_model.split("/", 1)[0]
    return {
        "anthropic": s.anthropic_api_key,
        "openai": s.openai_api_key,
        "gemini": s.gemini_api_key,
        "deepseek": s.deepseek_api_key,
    }.get(prefix) or None


def _with_prompt_cache(model: AIModel, messages: list[dict]) -> list[dict]:
    """Claude: đánh dấu phần hướng dẫn hệ thống dài để được tính giá cache khi gửi lặp lại."""
    if not model.provider_model.startswith("anthropic/"):
        return messages
    out = copy.deepcopy(messages)
    for m in out:
        if m.get("role") == "system" and isinstance(m.get("content"), str) and len(m["content"]) > 4000:
            m["content"] = [{"type": "text", "text": m["content"], "cache_control": {"type": "ephemeral"}}]
            break
    return out


def _usage_numbers(usage: Any) -> tuple[int, int, int]:
    if usage is None:
        return 0, 0, 0
    get = usage.get if isinstance(usage, dict) else lambda k, d=None: getattr(usage, k, d)
    pin = int(get("prompt_tokens", 0) or 0)
    pout = int(get("completion_tokens", 0) or 0)
    details = get("prompt_tokens_details", None)
    cached = 0
    if details is not None:
        cached = int((details.get("cached_tokens") if isinstance(details, dict) else getattr(details, "cached_tokens", 0)) or 0)
    cached = cached or int(get("cache_read_input_tokens", 0) or 0)
    return pin, pout, cached


def _excerpt(messages: list[dict]) -> str:
    for m in reversed(messages):
        if m.get("role") == "user":
            c = m.get("content")
            if isinstance(c, list):
                c = " ".join(str(x.get("text", "")) for x in c if isinstance(x, dict))
            return str(c)[:500]
    return ""


def _mock_text(messages: list[dict]) -> str:
    return "[Chế độ thử] Hub đã nhận: " + _excerpt(messages)[:200]


def check_rate(p: Principal, web_limit: int = 30, bucket: str = "") -> None:
    """bucket: tách bộ đếm riêng (ví dụ "emb" cho tạo vector) để một lượt Hỏi tài liệu không bị tính 2 lượt."""
    minute = int(time.time() // 60)
    if p.api_key:
        limit, key = p.api_key.rpm_limit or 60, f"rl{bucket}:key:{p.api_key.id}:{minute}"
    elif p.user.role == "machine":
        # Tài khoản hệ thống (bot hộp thư) phục vụ nhiều khách cùng lúc: trần cao hơn người dùng web
        limit, key = 600, f"rl{bucket}:sys:{p.user.id}:{minute}"
    else:
        limit, key = web_limit, f"rl{bucket}:user:{p.user.id}:{minute}"
    if limit and kv().incr_window(key, 70) > limit:
        raise GatewayError(429, f"Vượt {limit} lượt mỗi phút, thử lại sau ít giây.", "rate_limited")


def _check_model_access(p: Principal, requested: str, m: AIModel) -> None:
    if m.admin_only and not p.is_admin and requested not in ("auto", ""):
        raise GatewayError(403, f"Model {m.label} chỉ admin được chọn trực tiếp. Hãy dùng auto.", "model_forbidden")
    if p.api_key and p.api_key.allowed_models and requested not in ("auto", "") and m.id not in p.api_key.allowed_models:
        raise GatewayError(403, f"Key này không được dùng model {m.id}.", "model_forbidden")


def _prepare(db: Session, p: Principal, model: str, messages: list[dict], task_hint: str | None) -> tuple[str, list[AIModel]]:
    if not p.user.active or (p.api_key and not p.api_key.active):
        raise GatewayError(401, "Tài khoản hoặc key đã bị khoá.", "inactive")
    check_rate(p, int(get_setting(db, "web_rpm_limit") or 30))
    try:
        ensure_quota(db, p)
    except QuotaExceeded as e:
        raise GatewayError(402, e.message, "quota_exceeded") from e
    task, models = candidates(db, model, messages, task_hint)
    if not models:
        raise GatewayError(400, f"Không có model '{model}' hoặc model đang tắt.", "model_not_found")
    _check_model_access(p, model, models[0])
    return task, models


def _call(m: AIModel, messages: list[dict], stream: bool, params: dict[str, Any]):
    if get_settings().mock_llm:
        return _mock_call(m, messages, stream)
    kwargs = {k: v for k, v in params.items() if k in PASS_PARAMS and v is not None}
    if stream:
        kwargs["stream"] = True
        kwargs["stream_options"] = {"include_usage": True}
    return litellm.completion(
        model=m.provider_model,
        messages=_with_prompt_cache(m, messages),
        api_key=_api_key_for(m.provider_model),
        timeout=180,
        num_retries=1,
        **kwargs,
    )


def _mock_call(m: AIModel, messages: list[dict], stream: bool):
    text = _mock_text(messages)
    usage = {"prompt_tokens": 20, "completion_tokens": len(text) // 4, "total_tokens": 20 + len(text) // 4}
    if not stream:
        return {
            "id": "mock-1", "object": "chat.completion", "created": int(time.time()), "model": m.provider_model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
            "usage": usage,
        }

    def gen():
        for i in range(0, len(text), 12):
            yield {"id": "mock-1", "object": "chat.completion.chunk", "model": m.provider_model,
                   "choices": [{"index": 0, "delta": {"content": text[i:i + 12]}, "finish_reason": None}]}
        yield {"id": "mock-1", "object": "chat.completion.chunk", "model": m.provider_model,
               "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "usage": usage}

    return gen()


def _to_dict(obj: Any) -> dict:
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "model_dump"):
        return obj.model_dump(exclude_none=True)
    return dict(obj)


# ---------------- API chính ----------------
def chat(
    db: Session,
    p: Principal,
    *,
    app: str,
    messages: list[dict],
    model: str = "auto",
    feature: str = "",
    params: dict[str, Any] | None = None,
    task_hint: str | None = None,
    use_cache: bool = True,
    branch_id: int | None = None,
) -> ChatResult:
    params = params or {}
    task, models = _prepare(db, p, model, messages, task_hint)
    ttl = float(get_setting(db, "cache_ttl_hours") or 0)
    can_cache = use_cache and ttl > 0 and not params.get("tools")
    ckey = resp_cache.cache_key(models[0].id, messages, {k: params.get(k) for k in PASS_PARAMS}) if can_cache else ""
    if can_cache:
        hit = resp_cache.get(ckey)
        if hit:
            content = hit["choices"][0]["message"].get("content") or ""
            log_usage(db, p, app=app, feature=feature, model_requested=model, model_used=models[0].id, task=task,
                      cache_hit=True, excerpt=_excerpt(messages), branch_id=branch_id)
            return ChatResult(content=content, model_used=models[0].id, task=task, cache_hit=True, raw=hit)

    last_err: Exception | None = None
    for m in models:
        t0 = time.time()
        try:
            resp = _to_dict(_call(m, messages, False, params))
        except Exception as e:  # noqa: BLE001
            last_err = e
            log.warning("Model %s lỗi, thử dự phòng: %s", m.id, e)
            log_usage(db, p, app=app, feature=feature, model_requested=model, model_used=m.id, task=task,
                      status="error", error=str(e), latency_ms=int((time.time() - t0) * 1000), branch_id=branch_id)
            continue
        pin, pout, cached = _usage_numbers(resp.get("usage"))
        cost = token_cost_vnd(db, m, pin, pout, cached)
        content = ((resp.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        log_usage(db, p, app=app, feature=feature, model_requested=model, model_used=m.id, task=task,
                  input_tokens=pin, output_tokens=pout, cached_tokens=cached, cost_vnd=cost,
                  latency_ms=int((time.time() - t0) * 1000), excerpt=_excerpt(messages), branch_id=branch_id)
        if can_cache and content:
            resp_cache.put(ckey, resp, ttl)
        return ChatResult(content=content, model_used=m.id, task=task, input_tokens=pin, output_tokens=pout,
                          cached_tokens=cached, cost_vnd=cost, raw=resp)
    raise GatewayError(502, f"Hãng AI đang lỗi, đã thử {len(models)} model: {last_err}", "upstream_error")


def chat_stream(
    db: Session,
    p: Principal,
    *,
    app: str,
    messages: list[dict],
    model: str = "auto",
    feature: str = "",
    params: dict[str, Any] | None = None,
    task_hint: str | None = None,
    branch_id: int | None = None,
) -> Iterator[dict | ChatResult]:
    """Sinh từng chunk (dict chuẩn OpenAI). Phần tử cuối cùng là ChatResult để người gọi biết token/chi phí."""
    params = params or {}
    task, models = _prepare(db, p, model, messages, task_hint)
    last_err: Exception | None = None
    for m in models:
        t0 = time.time()
        try:
            stream = _call(m, messages, True, params)
            iterator = iter(stream)
            first = next(iterator)
        except StopIteration:
            continue
        except Exception as e:  # noqa: BLE001
            last_err = e
            log.warning("Model %s lỗi khi stream, thử dự phòng: %s", m.id, e)
            log_usage(db, p, app=app, feature=feature, model_requested=model, model_used=m.id, task=task,
                      status="error", error=str(e), branch_id=branch_id)
            continue
        text_parts: list[str] = []
        usage = None
        logged = False

        def finish(note: str = "") -> ChatResult:
            content = "".join(text_parts)
            pin, pout, cached = _usage_numbers(usage)
            if not pin and not pout:
                if get_settings().mock_llm:
                    pin, pout = sum(len(str(x.get("content", ""))) for x in messages) // 4, len(content) // 4
                else:
                    try:
                        pin = litellm.token_counter(model=m.provider_model, messages=messages)
                        pout = litellm.token_counter(model=m.provider_model, text=content)
                    except Exception:  # noqa: BLE001
                        pin, pout = sum(len(str(x.get("content", ""))) for x in messages) // 4, len(content) // 4
            cost = token_cost_vnd(db, m, pin, pout, cached)
            log_usage(db, p, app=app, feature=feature, model_requested=model, model_used=m.id, task=task,
                      input_tokens=pin, output_tokens=pout, cached_tokens=cached, cost_vnd=cost, error=note,
                      latency_ms=int((time.time() - t0) * 1000), excerpt=_excerpt(messages), branch_id=branch_id)
            return ChatResult(content=content, model_used=m.id, task=task, input_tokens=pin, output_tokens=pout,
                              cached_tokens=cached, cost_vnd=cost)

        try:
            try:
                for chunk in _chain(first, iterator):
                    d = _to_dict(chunk)
                    if d.get("usage"):
                        usage = d["usage"]
                    for ch in d.get("choices") or []:
                        piece = (ch.get("delta") or {}).get("content")
                        if piece:
                            text_parts.append(piece)
                    yield d
            except Exception as e:  # noqa: BLE001 — đứt giữa chừng: vẫn ghi phần đã dùng
                log.warning("Stream đứt: %s", e)
            result = finish()
            logged = True
            yield result
            return
        finally:
            # Người gọi ngắt kết nối giữa chừng (GeneratorExit): hãng vẫn tính tiền phần đã sinh → vẫn ghi
            # nhật ký, nếu không thì bấm dừng trước khi stream kết thúc là dùng AI không bị trừ hạn mức.
            if not logged:
                try:
                    finish("Người gọi ngắt kết nối giữa chừng")
                except Exception as e:  # noqa: BLE001
                    log.warning("Không ghi được nhật ký stream bị ngắt: %s", e)
    raise GatewayError(502, f"Hãng AI đang lỗi, đã thử {len(models)} model: {last_err}", "upstream_error")


def _chain(first, rest):
    yield first
    yield from rest


def _special_model(db: Session, kind: str, preferred: str | None = None) -> AIModel:
    q = db.query(AIModel).filter(AIModel.kind == kind, AIModel.enabled.is_(True))
    if preferred:
        m = db.get(AIModel, preferred)
        if m and m.enabled and m.kind == kind:
            return m
    m = q.order_by(AIModel.sort).first()
    if m is None:
        raise GatewayError(400, f"Chưa bật model loại {kind} trong trang quản trị.", "model_not_found")
    return m


def embed(db: Session, p: Principal | None, texts: list[str], *, app: str = "apps", feature: str = "embed") -> list[list[float]]:
    """Tạo vector cho tìm kiếm tài liệu. p=None khi hệ thống tự chạy (lập chỉ mục tài liệu trong worker).

    Có người gọi (p) thì kiểm tra hạn mức và tốc độ TRƯỚC khi gọi hãng — nếu không, người đã hết hạn mức
    vẫn gọi Hỏi tài liệu liên tục được (mỗi lượt tốn tiền tạo vector rồi mới bị chặn ở bước hỏi AI)."""
    m = _special_model(db, "embedding")
    if p is not None:
        check_rate(p, int(get_setting(db, "web_rpm_limit") or 30), bucket="emb")
        try:
            ensure_quota(db, p)
        except QuotaExceeded as e:
            raise GatewayError(402, e.message, "quota_exceeded") from e
    dim = get_settings().embed_dim
    if get_settings().mock_llm:
        import hashlib

        out = []
        for t in texts:
            h = hashlib.sha256(t.encode()).digest()
            out.append([(h[i % len(h)] - 128) / 128 for i in range(dim)])
        return out
    vectors: list[list[float]] = []
    total_tokens = 0
    t0 = time.time()
    for i in range(0, len(texts), 64):
        batch = texts[i:i + 64]
        resp = litellm.embedding(model=m.provider_model, input=batch, api_key=_api_key_for(m.provider_model), dimensions=dim if "text-embedding-3" in m.provider_model else None)
        d = _to_dict(resp)
        vectors.extend(item["embedding"] for item in d["data"])
        total_tokens += int((d.get("usage") or {}).get("prompt_tokens", 0) or 0)
    cost = token_cost_vnd(db, m, total_tokens, 0)
    log_usage(db, p, app=app, feature=feature, model_used=m.id, input_tokens=total_tokens, cost_vnd=cost,
              latency_ms=int((time.time() - t0) * 1000))
    return vectors


def transcribe(db: Session, p: Principal, file_path: str, *, seconds: float = 0, app: str = "apps", feature: str = "meeting") -> str:
    m = _special_model(db, "stt")
    if p:
        try:
            ensure_quota(db, p)
        except QuotaExceeded as e:
            raise GatewayError(402, e.message, "quota_exceeded") from e
    if get_settings().mock_llm:
        return "[Chế độ thử] Nội dung ghi âm cuộc họp."
    t0 = time.time()
    with open(file_path, "rb") as f:
        resp = litellm.transcription(model=m.provider_model, file=f, api_key=_api_key_for(m.provider_model), language="vi")
    text = _to_dict(resp).get("text", "")
    log_usage(db, p, app=app, feature=feature, model_used=m.id, units=int(seconds), cost_vnd=minute_cost_vnd(m, seconds),
              latency_ms=int((time.time() - t0) * 1000))
    return text
