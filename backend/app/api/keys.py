"""Key nội bộ tl-... cho n8n, Claude Code, Cursor. Key đầy đủ chỉ hiện một lần lúc tạo."""
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import web_user
from ..models import ApiKey, User
from ..security import new_api_key
from ..services.principal import Principal
from ..services.quota import spent
from ..services.timeutil import VN, day_start

router = APIRouter(prefix="/api/keys", tags=["keys"])


def key_out(db: Session, k: ApiKey) -> dict:
    return {
        "id": k.id, "name": k.name, "prefix": k.prefix + "…", "user_id": k.user_id, "user_name": k.user.name,
        "daily_limit_vnd": k.daily_limit_vnd, "rpm_limit": k.rpm_limit, "allowed_models": k.allowed_models,
        "active": k.active, "today_used_vnd": float(spent(db, day_start(), api_key_id=k.id)),
        "last_used_at": k.last_used_at.astimezone(VN).strftime("%H:%M %d/%m") if k.last_used_at else None,
        "created_at": k.created_at.astimezone(VN).strftime("%d/%m/%Y"),
    }


@router.get("")
def list_keys(all: bool = False, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    q = select(ApiKey).where(ApiKey.revoked_at.is_(None)).order_by(ApiKey.id.desc())
    if not (all and p.is_admin):
        q = q.where(ApiKey.user_id == p.user.id)
    return [key_out(db, k) for k in db.execute(q).scalars()]


class KeyIn(BaseModel):
    name: str
    daily_limit_vnd: int | None = None
    rpm_limit: int = 60
    allowed_models: list[str] | None = None
    user_id: int | None = None  # admin tạo key cho tài khoản khác (ví dụ tài khoản máy n8n)


@router.post("")
def create_key(body: KeyIn, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    owner_id = p.user.id
    if body.user_id and body.user_id != p.user.id:
        if not p.is_admin:
            raise HTTPException(403, "Chỉ admin tạo key cho người khác.")
        if db.get(User, body.user_id) is None:
            raise HTTPException(404, "Không có tài khoản này.")
        owner_id = body.user_id
    raw, prefix, h = new_api_key()
    k = ApiKey(user_id=owner_id, name=body.name.strip() or "Key", prefix=prefix, key_hash=h,
               daily_limit_vnd=body.daily_limit_vnd, rpm_limit=max(1, min(body.rpm_limit, 600)),
               allowed_models=body.allowed_models or None)
    db.add(k)
    db.commit()
    db.refresh(k)
    return {**key_out(db, k), "key": raw}


class KeyPatch(BaseModel):
    name: str | None = None
    daily_limit_vnd: int | None = None
    clear_daily_limit: bool = False
    rpm_limit: int | None = None
    active: bool | None = None


def _get_key(db: Session, p: Principal, kid: int) -> ApiKey:
    k = db.get(ApiKey, kid)
    if k is None or k.revoked_at is not None or (k.user_id != p.user.id and not p.is_admin):
        raise HTTPException(404, "Không tìm thấy key.")
    return k


@router.patch("/{kid}")
def update_key(kid: int, body: KeyPatch, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    k = _get_key(db, p, kid)
    if body.name is not None:
        k.name = body.name
    if body.clear_daily_limit:
        k.daily_limit_vnd = None
    elif body.daily_limit_vnd is not None:
        k.daily_limit_vnd = body.daily_limit_vnd
    if body.rpm_limit is not None:
        k.rpm_limit = max(1, min(body.rpm_limit, 600))
    if body.active is not None:
        k.active = body.active
    db.commit()
    return key_out(db, k)


@router.delete("/{kid}")
def revoke_key(kid: int, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    k = _get_key(db, p, kid)
    k.active = False
    k.revoked_at = datetime.now(UTC)
    db.commit()
    return {"ok": True}
