"""Chat AI trên web: hội thoại, câu lệnh mẫu, trả lời dạng stream (SSE)."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db, session_factory
from ..deps import web_user
from ..models import AIModel, ChatMessage, Conversation, PromptTemplate
from ..services import llm
from ..services.principal import Principal
from ..services.timeutil import VN
from .common import primed, sse

router = APIRouter(prefix="/api", tags=["chat"])

SYSTEM_PROMPT = (
    "Bạn là trợ lý AI nội bộ của Thi Lốp — chuỗi dịch vụ lốp, ắc quy, chăm sóc và sửa chữa ô tô. "
    "Trả lời bằng tiếng Việt, ngắn gọn, đúng trọng tâm. Không bịa giá hay chính sách: chỗ nào chưa có số liệu thì để dạng [GIÁ], [THÔNG TIN]."
)


@router.get("/models")
def list_models(p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    rows = db.execute(select(AIModel).where(AIModel.enabled.is_(True), AIModel.kind == "chat").order_by(AIModel.sort)).scalars()
    out = [{"id": "auto", "label": "Auto (router chọn)", "vision": True, "note": "Việc dễ sang model rẻ, việc khó sang model mạnh"}]
    out += [{"id": m.id, "label": m.label, "vision": m.vision, "note": m.note} for m in rows if p.is_admin or not m.admin_only]
    return out


@router.get("/prompts")
def prompts(scope: str = "chat", p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    rows = db.execute(select(PromptTemplate).where(PromptTemplate.scope == scope).order_by(PromptTemplate.sort)).scalars()
    return [{"id": r.id, "title": r.title, "text": r.text} for r in rows]


def _conv_out(c: Conversation) -> dict:
    return {"id": c.id, "title": c.title, "model": c.model, "updated_at": c.updated_at.astimezone(VN).isoformat()}


def _own(db: Session, p: Principal, cid: int) -> Conversation:
    c = db.get(Conversation, cid)
    if c is None or c.user_id != p.user.id:
        raise HTTPException(404, "Không tìm thấy hội thoại.")
    return c


@router.get("/chat/conversations")
def conversations(p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    rows = db.execute(select(Conversation).where(Conversation.user_id == p.user.id).order_by(Conversation.updated_at.desc()).limit(100)).scalars()
    return [_conv_out(c) for c in rows]


class NewConv(BaseModel):
    title: str | None = None
    model: str = "auto"


@router.post("/chat/conversations")
def create_conversation(body: NewConv, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    c = Conversation(user_id=p.user.id, title=body.title or "Hội thoại mới", model=body.model)
    db.add(c)
    db.commit()
    db.refresh(c)
    return _conv_out(c)


@router.get("/chat/conversations/{cid}")
def get_conversation(cid: int, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    c = _own(db, p, cid)
    msgs = db.execute(select(ChatMessage).where(ChatMessage.conversation_id == cid).order_by(ChatMessage.id)).scalars()
    return {**_conv_out(c), "messages": [{
        "id": m.id, "role": m.role, "content": m.content, "model_used": m.model_used, "tokens": m.tokens,
        "cost_vnd": float(m.cost_vnd), "time": m.created_at.astimezone(VN).strftime("%H:%M %d/%m"),
    } for m in msgs]}


@router.delete("/chat/conversations/{cid}")
def delete_conversation(cid: int, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    c = _own(db, p, cid)
    db.delete(c)
    db.commit()
    return {"ok": True}


class SendIn(BaseModel):
    content: str
    model: str = "auto"
    images: list[str] = []  # data URL ảnh (data:image/png;base64,...)


@router.post("/chat/conversations/{cid}/messages")
def send_message(cid: int, body: SendIn, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    c = _own(db, p, cid)
    if not body.content.strip() and not body.images:
        raise HTTPException(400, "Tin nhắn trống.")
    history = db.execute(select(ChatMessage).where(ChatMessage.conversation_id == cid).order_by(ChatMessage.id.desc()).limit(20)).scalars().all()
    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages += [{"role": m.role, "content": m.content} for m in reversed(history)]
    if body.images:
        parts: list[dict] = [{"type": "text", "text": body.content}]
        parts += [{"type": "image_url", "image_url": {"url": u}} for u in body.images[:4]]
        messages.append({"role": "user", "content": parts})
    else:
        messages.append({"role": "user", "content": body.content})

    db.add(ChatMessage(conversation_id=cid, role="user", content=body.content + (f"\n[{len(body.images)} ảnh]" if body.images else "")))
    if c.title == "Hội thoại mới":
        c.title = body.content.strip().split("\n")[0][:60] or "Hội thoại có ảnh"
    c.model = body.model
    db.commit()

    # Session riêng cho stream (request kết thúc thì session của request đóng)
    sdb = session_factory()()
    try:
        gen = primed(llm.chat_stream(sdb, p, app="chat", feature="chat", model=body.model, messages=messages))
    except Exception:
        sdb.close()
        raise

    def events():
        try:
            for item in gen:
                if isinstance(item, llm.ChatResult):
                    msg = ChatMessage(conversation_id=cid, role="assistant", content=item.content, model_used=item.model_used,
                                      tokens=item.input_tokens + item.output_tokens, cost_vnd=item.cost_vnd)
                    sdb.add(msg)
                    conv = sdb.get(Conversation, cid)
                    if conv:
                        conv.title = conv.title  # chạm updated_at
                    sdb.commit()
                    yield sse({"done": True, "message_id": msg.id, "model_used": item.model_used, "task": item.task,
                               "tokens": item.input_tokens + item.output_tokens, "cost_vnd": float(item.cost_vnd)})
                else:
                    for ch in item.get("choices") or []:
                        piece = (ch.get("delta") or {}).get("content")
                        if piece:
                            yield sse({"delta": piece})
        except llm.GatewayError as e:
            yield sse({"error": e.message})
        finally:
            # Khách đóng trang giữa chừng → đóng luôn generator để llm.chat_stream ghi phần đã dùng vào nhật ký
            close = getattr(gen, "close", None)
            if close:
                close()
            sdb.close()

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
