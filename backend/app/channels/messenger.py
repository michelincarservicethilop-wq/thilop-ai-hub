"""Kênh Facebook Messenger (fanpage) qua Meta Graph API.

Chính sách Meta (kiểm tra 22/10/2026):
- Trong 24 giờ kể từ tin cuối của khách: được trả lời tự do (bot hoặc người) với messaging_type=RESPONSE.
- Từ 24 giờ đến 7 ngày: chỉ nhân viên thật được trả lời, kèm thẻ HUMAN_AGENT (messaging_type=MESSAGE_TAG).
- Quá 7 ngày: không gửi được cho tới khi khách nhắn lại.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any

import httpx

from ..config import get_settings

log = logging.getLogger("hub.messenger")

BOT_WINDOW_HOURS = 24
STAFF_WINDOW_HOURS = 7 * 24
MAX_TEXT = 2000  # Messenger giới hạn 2000 ký tự mỗi tin


def _graph(path: str) -> str:
    return f"https://graph.facebook.com/{get_settings().graph_api_version}/{path.lstrip('/')}"


def configured() -> bool:
    return bool(get_settings().messenger_page_token)


def verify_signature(raw: bytes, header: str | None) -> bool:
    """X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app_secret, thân request gốc).

    Chưa cài app_secret: chỉ cho qua khi fanpage cũng chưa nối (chạy thử). Đã có MESSENGER_PAGE_TOKEN mà thiếu
    MESSENGER_APP_SECRET thì từ chối — nếu không, ai cũng giả được tin khách để bot tốn tiền AI và gửi tin ra fanpage."""
    s = get_settings()
    secret = s.messenger_app_secret
    if not secret:
        if s.messenger_page_token:
            log.error("Đã nối fanpage nhưng thiếu MESSENGER_APP_SECRET: từ chối webhook chưa ký")
            return False
        return True
    if not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode(), header[7:].strip().encode("utf-8", "replace"))


def parse_events(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Lấy các tin chữ khách gửi vào trang. Bỏ qua echo (tin trang tự gửi), báo đã nhận, đã xem, postback..."""
    out: list[dict[str, Any]] = []
    if payload.get("object") != "page":
        return out
    for entry in payload.get("entry") or []:
        for ev in entry.get("messaging") or []:
            msg = ev.get("message")
            if not isinstance(msg, dict) or msg.get("is_echo"):
                continue
            text = msg.get("text")
            psid = (ev.get("sender") or {}).get("id")
            if not text or not psid:
                continue  # ảnh, sticker... chưa xử lý
            out.append({"user_id": str(psid), "text": str(text), "mid": str(msg.get("mid") or ""),
                        "timestamp": ev.get("timestamp")})
    return out


def fetch_name(psid: str) -> str | None:
    """Lấy tên khách (không bắt buộc; lỗi thì trả None)."""
    s = get_settings()
    if not configured() or s.mock_llm:
        return None
    try:
        r = httpx.get(_graph(psid), params={"fields": "first_name,last_name", "access_token": s.messenger_page_token}, timeout=8)
        if r.status_code == 200:
            d = r.json()
            name = " ".join(x for x in (d.get("last_name"), d.get("first_name")) if x).strip()
            return name or None
    except Exception as e:  # noqa: BLE001
        log.info("Không lấy được tên khách Messenger: %s", e)
    return None


def send_text(psid: str, text: str, *, human_agent: bool = False) -> bool:
    """Gửi tin chữ. human_agent=True dùng thẻ HUMAN_AGENT (nhân viên trả lời sau 24 giờ)."""
    s = get_settings()
    if not configured() or s.mock_llm:
        log.info("Messenger chưa cấu hình hoặc đang chế độ thử: không gửi tin tới %s", psid)
        return False
    body: dict[str, Any] = {"recipient": {"id": psid}, "message": {"text": text[:MAX_TEXT]}}
    if human_agent:
        body.update({"messaging_type": "MESSAGE_TAG", "tag": "HUMAN_AGENT"})
    else:
        body["messaging_type"] = "RESPONSE"
    try:
        r = httpx.post(_graph("me/messages"), params={"access_token": s.messenger_page_token}, json=body, timeout=15)
    except Exception as e:  # noqa: BLE001
        log.warning("Gửi Messenger lỗi: %s", e)
        return False
    if r.status_code != 200:
        log.warning("Gửi Messenger bị từ chối (%s): %s", r.status_code, r.text[:300])
        return False
    return True
