"""Xác thực: web dùng token đăng nhập (JWT), n8n/Claude Code dùng key nội bộ tl-..."""
from datetime import UTC, datetime

from fastapi import Depends, Header, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import ApiKey, User
from .security import KEY_PREFIX, decode_token, hash_key
from .services.principal import Principal


def _from_bearer(db: Session, raw: str) -> Principal | None:
    if raw.startswith(KEY_PREFIX):
        k = db.execute(select(ApiKey).where(ApiKey.key_hash == hash_key(raw))).scalar_one_or_none()
        if k is None or not k.active or not k.user.active:
            return None
        k.last_used_at = datetime.now(UTC)
        db.commit()
        return Principal(user=k.user, api_key=k)
    uid = decode_token(raw)
    if uid is None:
        return None
    u = db.get(User, uid)
    if u is None or not u.active:
        return None
    return Principal(user=u)


def get_principal(
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
    token: str | None = Query(default=None, include_in_schema=False),
) -> Principal:
    raw = None
    if authorization and authorization.lower().startswith("bearer "):
        raw = authorization[7:].strip()
    elif x_api_key:
        raw = x_api_key.strip()
    elif token:
        raw = token
    p = _from_bearer(db, raw) if raw else None
    if p is None:
        raise HTTPException(status_code=401, detail="Chưa đăng nhập hoặc key không hợp lệ.")
    return p


def web_user(p: Principal = Depends(get_principal)) -> Principal:
    """Trang web: chỉ người dùng thật (không phải tài khoản máy) đăng nhập bằng token web.

    Key tl-... chỉ dùng cho /v1 — không cho key (n8n, Claude Code...) gọi /api: nếu không, lộ một key là
    lộ cả tài khoản (tạo key mới không giới hạn, đổi cài đặt, đọc hộp thư, quyền admin của chủ key)."""
    if p.api_key is not None:
        raise HTTPException(status_code=403, detail="Key API chỉ dùng cho /v1, không dùng cho trang web.")
    if p.user.role == "machine":
        raise HTTPException(status_code=403, detail="Tài khoản máy chỉ gọi API.")
    return p


def manager(p: Principal = Depends(web_user)) -> Principal:
    if not p.is_manager:
        raise HTTPException(status_code=403, detail="Cần quyền quản lý.")
    return p


def admin(p: Principal = Depends(web_user)) -> Principal:
    if not p.is_admin:
        raise HTTPException(status_code=403, detail="Cần quyền admin.")
    return p
