"""Endpoint chuẩn Anthropic (/v1/messages) cho Claude Code / Claude Agent SDK.

Cài trên máy: ANTHROPIC_BASE_URL=https://ai.thilop.vn  và  ANTHROPIC_AUTH_TOKEN=tl-...(key nội bộ)
Hub kiểm tra key, hạn mức, tốc độ rồi chuyển tiếp nguyên văn sang Anthropic bằng key chính hãng, đo token, ghi nhật ký.
"""
import json
import time

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select

from ..config import get_settings
from ..db import session_factory
from ..deps import get_principal
from ..models import AIModel
from ..services import llm
from ..services.pricing import token_cost_vnd
from ..services.principal import Principal
from ..services.quota import QuotaExceeded, ensure_quota
from ..services.settings_store import get_setting
from ..services.usage import log_usage

router = APIRouter(prefix="/v1", tags=["anthropic"])
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"


def _err(status: int, message: str, typ: str = "api_error") -> JSONResponse:
    return JSONResponse(status_code=status, content={"type": "error", "error": {"type": typ, "message": message}})


async def _body(request: Request) -> dict | JSONResponse:
    try:
        body = await request.json()
    except ValueError:
        return _err(400, "Thân request không phải JSON hợp lệ.", "invalid_request_error")
    if not isinstance(body, dict):
        return _err(400, "Thân request phải là một object JSON.", "invalid_request_error")
    return body


def _resolve(db, name: str) -> AIModel | None:
    m = db.get(AIModel, name)
    if m and m.provider_model.startswith("anthropic/"):
        return m
    return db.execute(select(AIModel).where(AIModel.provider_model == f"anthropic/{name}")).scalar_one_or_none()


def _headers(request: Request) -> dict:
    h = {
        "x-api-key": get_settings().anthropic_api_key,
        "anthropic-version": request.headers.get("anthropic-version", "2023-06-01"),
        "content-type": "application/json",
    }
    if request.headers.get("anthropic-beta"):
        h["anthropic-beta"] = request.headers["anthropic-beta"]
    return h


@router.post("/messages")
async def messages(request: Request, p: Principal = Depends(get_principal)):
    body = await _body(request)
    if isinstance(body, JSONResponse):
        return body
    db = session_factory()()
    try:
        name = body.get("model", "")
        m = _resolve(db, name)
        if m is None or not m.enabled:
            return _err(400, f"Model '{name}' chưa được bật trong Hub (Quản trị › Model).", "invalid_request_error")
        if m.admin_only and not p.is_admin:
            return _err(403, f"Model {m.label} chỉ admin được dùng.", "permission_error")
        if p.api_key and p.api_key.allowed_models and m.id not in p.api_key.allowed_models:
            return _err(403, f"Key này không được dùng model {m.id}.", "permission_error")
        try:
            llm.check_rate(p, int(get_setting(db, "web_rpm_limit") or 30))
            ensure_quota(db, p)
        except llm.GatewayError as e:
            return _err(e.status_code, e.message, "rate_limit_error")
        except QuotaExceeded as e:
            return _err(402, e.message, "billing_error")
        body["model"] = m.provider_model.split("/", 1)[1]
        model_id = m.id
    finally:
        db.close()

    t0 = time.time()
    if not body.get("stream"):
        async with httpx.AsyncClient(timeout=600) as client:
            r = await client.post(ANTHROPIC_URL, headers=_headers(request), json=body)
        data = r.json()
        usage = data.get("usage") or {}
        _log(p, model_id, usage, int((time.time() - t0) * 1000), r.status_code, data)
        return JSONResponse(status_code=r.status_code, content=data)

    async def relay():
        usage: dict = {}
        status = 200
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream("POST", ANTHROPIC_URL, headers=_headers(request), json=body) as r:
                    status = r.status_code
                    buf = ""
                    async for chunk in r.aiter_text():
                        yield chunk.encode()
                        buf += chunk
                        while "\n" in buf:
                            line, buf = buf.split("\n", 1)
                            if line.startswith("data:"):
                                try:
                                    ev = json.loads(line[5:].strip())
                                except ValueError:
                                    continue
                                if ev.get("type") == "message_start":
                                    usage.update((ev.get("message") or {}).get("usage") or {})
                                elif ev.get("type") == "message_delta":
                                    usage.update(ev.get("usage") or {})
        finally:
            # Claude Code bấm Esc / mất mạng giữa chừng: Anthropic vẫn tính token vào (message_start) → vẫn ghi
            _log(p, model_id, usage, int((time.time() - t0) * 1000), status, None)

    return StreamingResponse(relay(), media_type="text/event-stream")


@router.post("/messages/count_tokens")
async def count_tokens(request: Request, p: Principal = Depends(get_principal)):
    body = await _body(request)
    if isinstance(body, JSONResponse):
        return body
    db = session_factory()()
    try:
        m = _resolve(db, body.get("model", ""))
        if m:
            body["model"] = m.provider_model.split("/", 1)[1]
    finally:
        db.close()
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(ANTHROPIC_URL + "/count_tokens", headers=_headers(request), json=body)
    return JSONResponse(status_code=r.status_code, content=r.json())


def _log(p: Principal, model_id: str, usage: dict, latency: int, status: int, data: dict | None) -> None:
    db = session_factory()()
    try:
        m = db.get(AIModel, model_id)
        pin = int(usage.get("input_tokens", 0) or 0)
        cache_read = int(usage.get("cache_read_input_tokens", 0) or 0)
        cache_write = int(usage.get("cache_creation_input_tokens", 0) or 0)
        pout = int(usage.get("output_tokens", 0) or 0)
        # Ghi cache Claude tính 1,25 lần giá vào; quy về token vào tương đương
        total_in = pin + cache_read + int(cache_write * 1.25)
        cost = token_cost_vnd(db, m, total_in, pout, cache_read) if m else 0
        err = "" if status < 400 else json.dumps((data or {}).get("error") or {}, ensure_ascii=False)
        log_usage(db, p, app="api", feature="claude-code", model_requested=model_id, model_used=model_id,
                  input_tokens=total_in, output_tokens=pout, cached_tokens=cache_read, cost_vnd=cost,
                  latency_ms=latency, status="ok" if status < 400 else "error", error=err)
    finally:
        db.close()
