"""Endpoint chuẩn OpenAI: dán Base URL + key nội bộ vào n8n, Claude Code (qua lớp tương thích), Cursor..."""
import time

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db, session_factory
from ..deps import get_principal
from ..models import AIModel
from ..services import llm
from ..services.principal import Principal
from .common import sse

router = APIRouter(prefix="/v1", tags=["openai"])


def _err(e: llm.GatewayError) -> JSONResponse:
    return JSONResponse(status_code=e.status_code, content={"error": {"message": e.message, "type": e.code, "code": e.code}})


@router.get("/models")
def models(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    rows = db.execute(select(AIModel).where(AIModel.enabled.is_(True), AIModel.kind == "chat").order_by(AIModel.sort)).scalars()
    data = [{"id": "auto", "object": "model", "owned_by": "thilop-hub"}]
    data += [{"id": m.id, "object": "model", "owned_by": m.provider_model.split("/")[0]} for m in rows if p.is_admin or not m.admin_only]
    return {"object": "list", "data": data}


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    p: Principal = Depends(get_principal),
    x_task: str | None = Header(default=None),
    x_app: str | None = Header(default=None),
):
    try:
        body = await request.json()
    except ValueError:
        return _err(llm.GatewayError(400, "Thân request không phải JSON hợp lệ.", "invalid_request_error"))
    if not isinstance(body, dict):
        return _err(llm.GatewayError(400, "Thân request phải là một object JSON.", "invalid_request_error"))
    messages = body.get("messages") or []
    if not isinstance(messages, list) or not all(isinstance(m, dict) for m in messages):
        return _err(llm.GatewayError(400, "'messages' phải là danh sách object.", "invalid_request_error"))
    model = body.get("model") or "auto"
    params = {k: body.get(k) for k in llm.PASS_PARAMS if k in body}
    app = x_app if x_app in ("api", "apps", "studio", "inbox") else "api"

    db = session_factory()()
    if not body.get("stream"):
        try:
            r = llm.chat(db, p, app=app, feature="v1", model=model, messages=messages, params=params, task_hint=x_task,
                         use_cache=body.get("cache", True) is not False)
        except llm.GatewayError as e:
            return _err(e)
        finally:
            db.close()
        out = dict(r.raw)
        out["model"] = r.model_used
        out.setdefault("id", f"chatcmpl-hub-{int(time.time() * 1000)}")
        out.setdefault("object", "chat.completion")
        out["x_hub"] = {"task": r.task, "cost_vnd": float(r.cost_vnd), "cache_hit": r.cache_hit}
        return out

    gen = llm.chat_stream(db, p, app=app, feature="v1", model=model, messages=messages, params=params, task_hint=x_task)
    try:
        first = next(gen)
    except llm.GatewayError as e:
        db.close()
        return _err(e)
    except StopIteration:
        db.close()
        return _err(llm.GatewayError(502, "Hãng AI không trả kết quả."))

    def events():
        try:
            item = first
            while True:
                if isinstance(item, llm.ChatResult):
                    break
                item["model"] = item.get("model") or model
                yield sse(item)
                item = next(gen)
        except StopIteration:
            pass
        except llm.GatewayError as e:
            yield sse({"error": {"message": e.message, "type": e.code}})
        finally:
            gen.close()  # người gọi ngắt giữa chừng → chat_stream vẫn ghi phần đã dùng
            db.close()
        yield "data: [DONE]\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
