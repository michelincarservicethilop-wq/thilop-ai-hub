"""Webhook do Meta (Messenger) và Zalo OA gọi vào. Không dùng token đăng nhập; xác thực bằng chữ ký.

Trả 200 ngay, phần xử lý (gọi AI, gửi tin) chạy nền bằng BackgroundTasks để kênh không gửi lại.
"""
import json
import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import select

from ..channels import messenger, zalo
from ..config import get_settings
from ..db import session_factory
from ..models import CustomerConversation
from ..services import inbox_bot

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
log = logging.getLogger("hub.webhooks")


def _process(channel: str, user_id: str, text: str, external_id: str, fetch_name: bool = False) -> None:
    """Chạy nền với phiên CSDL riêng (phiên của request đã đóng)."""
    with session_factory()() as db:
        try:
            name = None
            if fetch_name:
                exists = db.execute(select(CustomerConversation.id).where(
                    CustomerConversation.channel == channel, CustomerConversation.external_user_id == user_id)).first()
                if not exists:
                    name = messenger.fetch_name(user_id)
            inbox_bot.handle_incoming(db, channel, user_id, name, text, external_id=external_id, send=True)
        except Exception:  # noqa: BLE001 — lỗi một tin không làm hỏng webhook
            log.exception("Xử lý tin %s từ %s lỗi", channel, user_id)
            db.rollback()


def _json(raw: bytes) -> dict:
    try:
        v = json.loads(raw or b"{}")
    except ValueError as e:
        raise HTTPException(400, "Dữ liệu không phải JSON.") from e
    if not isinstance(v, dict):
        raise HTTPException(400, "Dữ liệu không hợp lệ.")
    return v


# ---------------- Messenger ----------------
@router.get("/messenger")
def messenger_verify(
    mode: str = Query("", alias="hub.mode"),
    token: str = Query("", alias="hub.verify_token"),
    challenge: str = Query("", alias="hub.challenge"),
):
    """Meta gọi khi đăng ký webhook: đúng verify token thì trả lại challenge dạng chữ."""
    expected = get_settings().messenger_verify_token
    if mode == "subscribe" and expected and token == expected:
        return PlainTextResponse(challenge)
    raise HTTPException(403, "Sai mã xác minh webhook.")


@router.post("/messenger")
async def messenger_webhook(request: Request, background: BackgroundTasks):
    raw = await request.body()
    if not messenger.verify_signature(raw, request.headers.get("x-hub-signature-256")):
        raise HTTPException(403, "Sai chữ ký.")
    for ev in messenger.parse_events(_json(raw)):
        background.add_task(_process, "messenger", ev["user_id"], ev["text"], ev["mid"], True)
    return PlainTextResponse("EVENT_RECEIVED")


# ---------------- Zalo OA ----------------
@router.post("/zalo")
async def zalo_webhook(request: Request, background: BackgroundTasks):
    raw = await request.body()
    payload = _json(raw)
    if not zalo.verify_signature(raw, payload, request.headers.get("x-zevent-signature")):
        raise HTTPException(403, "Sai chữ ký.")
    ev = zalo.parse_event(payload)
    if ev:
        background.add_task(_process, "zalo", ev["user_id"], ev["text"], ev["msg_id"])
    return {"ok": True}
