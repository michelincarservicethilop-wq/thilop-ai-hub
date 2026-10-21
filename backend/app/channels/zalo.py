"""Kênh Zalo OA (Official Account) qua Zalo OpenAPI.

Token lưu trong bảng settings, khoá "zalo_tokens" = {access_token, refresh_token, expires_at}.
Khoá này cố ý KHÔNG nằm trong settings_store.DEFAULTS nên không bao giờ hiện ra trang Cài đặt.
Refresh token lần đầu lấy từ biến môi trường ZALO_REFRESH_TOKEN; mỗi lần làm mới Zalo trả refresh token mới.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import time
from typing import Any

import httpx
from sqlalchemy.orm import Session

from ..config import get_settings
from ..services.settings_store import get_setting, set_setting

log = logging.getLogger("hub.zalo")

TOKEN_KEY = "zalo_tokens"
TOKEN_URL = "https://oauth.zaloapp.com/v4/oa/access_token"
SEND_URL = "https://openapi.zalo.me/v3.0/oa/message/cs"
# Thời hạn OA được nhắn tin tư vấn (message/cs) sau tin cuối của khách.
# CHƯA xác nhận được giới hạn chính thức của Zalo — phải kiểm tra lại tài liệu Zalo trước khi chạy thật.
ZALO_REPLY_WINDOW_HOURS = 168
REFRESH_BEFORE_SECONDS = 2 * 3600  # làm mới khi token còn dưới 2 giờ


def configured() -> bool:
    s = get_settings()
    return bool(s.zalo_app_id and s.zalo_app_secret)


def verify_signature(raw: bytes, payload: dict[str, Any], header: str | None) -> bool:
    """X-ZEvent-Signature = "mac=" + sha256(app_id + thân request + timestamp + oa_secret_key).

    Công thức theo hiểu biết hiện tại — PHẢI kiểm tra lại với tài liệu Zalo for Developers trước khi chạy thật.
    Chỉ kiểm tra khi đã cài ZALO_OA_SECRET_KEY.
    """
    s = get_settings()
    if not s.zalo_oa_secret_key:
        return True
    if not header:
        return False
    sig = header[4:] if header.startswith("mac=") else header
    base = s.zalo_app_id + raw.decode("utf-8", errors="replace") + str(payload.get("timestamp", "")) + s.zalo_oa_secret_key
    return hmac.compare_digest(hashlib.sha256(base.encode()).hexdigest().encode(), sig.strip().encode("utf-8", "replace"))


def parse_event(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Chỉ xử lý sự kiện khách gửi tin chữ (user_send_text)."""
    if payload.get("event_name") != "user_send_text":
        return None
    uid = (payload.get("sender") or {}).get("id")
    msg = payload.get("message") or {}
    text = msg.get("text")
    if not uid or not text:
        return None
    return {"user_id": str(uid), "text": str(text), "msg_id": str(msg.get("msg_id") or "")}


# ---------------- Token ----------------
def _tokens(db: Session) -> dict[str, Any]:
    v = get_setting(db, TOKEN_KEY)
    return v if isinstance(v, dict) else {}


def refresh(db: Session) -> bool:
    """Đổi refresh token lấy access token mới. Không cấu hình / chế độ thử thì không gọi mạng."""
    s = get_settings()
    if not configured() or s.mock_llm:
        return False
    rt = _tokens(db).get("refresh_token") or s.zalo_refresh_token
    if not rt:
        log.warning("Chưa có refresh token Zalo (ZALO_REFRESH_TOKEN)")
        return False
    try:
        r = httpx.post(TOKEN_URL, headers={"secret_key": s.zalo_app_secret},
                       data={"refresh_token": rt, "app_id": s.zalo_app_id, "grant_type": "refresh_token"}, timeout=15)
        d = r.json()
    except Exception as e:  # noqa: BLE001
        log.warning("Làm mới token Zalo lỗi: %s", e)
        return False
    if not d.get("access_token"):
        log.warning("Zalo không cấp token mới: %s", str(d)[:300])
        return False
    set_setting(db, TOKEN_KEY, {
        "access_token": d["access_token"],
        "refresh_token": d.get("refresh_token") or rt,
        "expires_at": time.time() + float(d.get("expires_in") or 3600),
    })
    log.info("Đã làm mới token Zalo OA")
    return True


def refresh_if_needed(db: Session) -> bool:
    """Gọi định kỳ từ worker: chỉ làm mới khi chưa có token hoặc sắp hết hạn."""
    if not configured() or get_settings().mock_llm:
        return False
    t = _tokens(db)
    if t.get("access_token") and float(t.get("expires_at") or 0) - time.time() > REFRESH_BEFORE_SECONDS:
        return False
    return refresh(db)


def access_token(db: Session) -> str | None:
    t = _tokens(db)
    if not t.get("access_token") or float(t.get("expires_at") or 0) <= time.time() + 60:
        if not refresh(db):
            return None
        t = _tokens(db)
    return t.get("access_token")


# ---------------- Gửi tin ----------------
def send_text(db: Session, user_id: str, text: str) -> bool:
    s = get_settings()
    if not configured() or s.mock_llm:
        log.info("Zalo OA chưa cấu hình hoặc đang chế độ thử: không gửi tin tới %s", user_id)
        return False
    body = {"recipient": {"user_id": user_id}, "message": {"text": text[:2000]}}
    for attempt in range(2):
        token = access_token(db)
        if not token:
            return False
        try:
            r = httpx.post(SEND_URL, headers={"access_token": token}, json=body, timeout=15)
            d = r.json()
        except Exception as e:  # noqa: BLE001
            log.warning("Gửi Zalo lỗi: %s", e)
            return False
        if d.get("error") == 0:
            return True
        # -216: access token không hợp lệ (mã lỗi theo tài liệu Zalo, cần kiểm tra lại) → làm mới rồi thử 1 lần
        if d.get("error") == -216 and attempt == 0 and refresh(db):
            continue
        log.warning("Zalo từ chối tin nhắn: %s", str(d)[:300])
        return False
    return False
