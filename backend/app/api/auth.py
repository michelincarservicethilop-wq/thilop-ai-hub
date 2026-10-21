from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import web_user
from ..models import User
from ..security import create_token, hash_password, verify_password
from ..services.kv import kv
from ..services.principal import Principal
from ..services.quota import my_summary

router = APIRouter(prefix="/api", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


def user_out(u: User) -> dict:
    return {
        "id": u.id, "email": u.email, "name": u.name, "role": u.role, "branch_id": u.branch_id,
        "branch_name": u.branch.name if u.branch else None,
        "monthly_limit_vnd": u.monthly_limit_vnd, "daily_limit_vnd": u.daily_limit_vnd, "active": u.active,
    }


@router.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    fail_key = f"loginfail:{email}"
    fails = int(kv().get(fail_key) or 0)
    if fails >= 8:
        raise HTTPException(429, "Đăng nhập sai quá nhiều lần, thử lại sau 15 phút.")
    u = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if u is None or not u.active or u.role == "machine" or not verify_password(body.password, u.password_hash):
        kv().set(fail_key, str(fails + 1), ex=900)
        raise HTTPException(401, "Sai email hoặc mật khẩu.")
    kv().delete(fail_key)
    return {"token": create_token(u.id), "user": user_out(u)}


@router.get("/me")
def me(p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    return {"user": user_out(p.user), "quota": my_summary(db, p)}


class PasswordIn(BaseModel):
    old_password: str
    new_password: str


@router.post("/me/password")
def change_password(body: PasswordIn, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    if len(body.new_password) < 8:
        raise HTTPException(400, "Mật khẩu mới cần ít nhất 8 ký tự.")
    u = db.get(User, p.user.id)
    if not verify_password(body.old_password, u.password_hash):
        raise HTTPException(400, "Mật khẩu cũ không đúng.")
    u.password_hash = hash_password(body.new_password)
    db.commit()
    return {"ok": True}
