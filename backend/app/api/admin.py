"""Trang quản trị: người dùng, cơ sở & hạn mức, model & router, cài đặt, báo cáo, nhật ký."""
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import case, false, func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import admin, manager
from ..models import ROLES, AIModel, Branch, PromptTemplate, RouteRule, UsageLog, User
from ..security import hash_password
from ..services import llm
from ..services.principal import Principal
from ..services.quota import spent
from ..services.settings_store import DEFAULTS, all_settings, set_setting
from ..services.timeutil import VN, day_start, month_start
from .auth import user_out

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ---------------- Người dùng ----------------
class UserIn(BaseModel):
    email: str
    name: str
    password: str | None = None
    role: str = "staff"
    branch_id: int | None = None
    monthly_limit_vnd: int | None = None
    daily_limit_vnd: int | None = None
    active: bool = True


@router.get("/users")
def users(p: Principal = Depends(manager), db: Session = Depends(get_db)):
    q = _branch_scope(select(User).order_by(User.id), p, User.branch_id)
    m0 = month_start()
    return [{**user_out(u), "month_used_vnd": float(spent(db, m0, user_id=u.id))} for u in db.execute(q).scalars()]


def _branch_scope(q, p: Principal, col):
    """Quản lý chỉ thấy dữ liệu cơ sở mình. Quản lý chưa gán cơ sở thì không thấy gì
    (tránh `branch_id == None` thành `IS NULL` → thấy tài khoản admin và nhật ký không thuộc cơ sở nào)."""
    if p.is_admin:
        return q
    return q.where(col == p.branch_id) if p.branch_id is not None else q.where(false())


def _check_branch(db: Session, branch_id: int | None):
    if branch_id is not None and db.get(Branch, branch_id) is None:
        raise HTTPException(400, "Không tìm thấy cơ sở.")


def _check_role(role: str):
    if role not in ROLES:
        raise HTTPException(400, f"Vai trò phải là một trong {ROLES}.")


@router.post("/users")
def create_user(body: UserIn, p: Principal = Depends(admin), db: Session = Depends(get_db)):
    _check_role(body.role)
    _check_branch(db, body.branch_id)
    email = body.email.strip().lower()
    if db.execute(select(User.id).where(User.email == email)).first():
        raise HTTPException(400, "Email đã có.")
    if body.role != "machine" and (not body.password or len(body.password) < 8):
        raise HTTPException(400, "Mật khẩu cần ít nhất 8 ký tự.")
    u = User(email=email, name=body.name, role=body.role, branch_id=body.branch_id,
             monthly_limit_vnd=body.monthly_limit_vnd, daily_limit_vnd=body.daily_limit_vnd, active=body.active,
             password_hash=hash_password(body.password) if body.password else "")
    db.add(u)
    db.commit()
    db.refresh(u)
    return user_out(u)


@router.put("/users/{uid}")
def update_user(uid: int, body: UserIn, p: Principal = Depends(admin), db: Session = Depends(get_db)):
    _check_role(body.role)
    u = db.get(User, uid)
    if u is None:
        raise HTTPException(404, "Không có tài khoản.")
    if u.id == p.user.id and (body.role != "admin" or not body.active):
        raise HTTPException(400, "Không tự hạ quyền hoặc tự khoá chính mình.")
    _check_branch(db, body.branch_id)
    email = body.email.strip().lower()
    if db.execute(select(User.id).where(User.email == email, User.id != uid)).first():
        raise HTTPException(400, "Email đã có.")
    u.email, u.name, u.role, u.branch_id = email, body.name, body.role, body.branch_id
    u.monthly_limit_vnd, u.daily_limit_vnd, u.active = body.monthly_limit_vnd, body.daily_limit_vnd, body.active
    if body.password:
        if len(body.password) < 8:
            raise HTTPException(400, "Mật khẩu cần ít nhất 8 ký tự.")
        u.password_hash = hash_password(body.password)
    db.commit()
    return user_out(u)


# ---------------- Cơ sở & hạn mức ----------------
class BranchIn(BaseModel):
    name: str
    address: str = ""
    phone: str = ""
    hours: str = ""
    keywords: str = ""
    monthly_limit_vnd: int | None = None
    daily_limit_vnd: int | None = None
    telegram_chat_id: str = ""
    active: bool = True


def branch_out(db: Session, b: Branch) -> dict:
    return {
        "id": b.id, "name": b.name, "address": b.address, "phone": b.phone, "hours": b.hours, "keywords": b.keywords,
        "monthly_limit_vnd": b.monthly_limit_vnd, "daily_limit_vnd": b.daily_limit_vnd,
        "telegram_chat_id": b.telegram_chat_id, "active": b.active,
        "month_used_vnd": float(spent(db, month_start(), branch_id=b.id)),
        "today_used_vnd": float(spent(db, day_start(), branch_id=b.id)),
    }


@router.get("/branches")
def branches(p: Principal = Depends(manager), db: Session = Depends(get_db)):
    return [branch_out(db, b) for b in db.execute(select(Branch).order_by(Branch.id)).scalars()]


@router.post("/branches")
def create_branch(body: BranchIn, p: Principal = Depends(admin), db: Session = Depends(get_db)):
    b = Branch(**body.model_dump())
    db.add(b)
    db.commit()
    db.refresh(b)
    return branch_out(db, b)


@router.put("/branches/{bid}")
def update_branch(bid: int, body: BranchIn, p: Principal = Depends(admin), db: Session = Depends(get_db)):
    b = db.get(Branch, bid)
    if b is None:
        raise HTTPException(404, "Không có cơ sở.")
    for k, v in body.model_dump().items():
        setattr(b, k, v)
    db.commit()
    return branch_out(db, b)


# ---------------- Model & router ----------------
class ModelIn(BaseModel):
    id: str
    label: str
    provider_model: str
    kind: str = "chat"
    vision: bool = False
    enabled: bool = True
    admin_only: bool = False
    note: str = ""
    price_in_vnd: float | None = None
    price_out_vnd: float | None = None
    price_cache_vnd: float | None = None
    price_per_minute_vnd: float | None = None
    fallback_id: str | None = None
    sort: int = 100


def model_out(m: AIModel) -> dict:
    f = lambda v: float(v) if v is not None else None  # noqa: E731
    return {
        "id": m.id, "label": m.label, "provider_model": m.provider_model, "kind": m.kind, "vision": m.vision,
        "enabled": m.enabled, "admin_only": m.admin_only, "note": m.note, "price_in_vnd": f(m.price_in_vnd),
        "price_out_vnd": f(m.price_out_vnd), "price_cache_vnd": f(m.price_cache_vnd),
        "price_per_minute_vnd": f(m.price_per_minute_vnd), "fallback_id": m.fallback_id, "sort": m.sort,
    }


@router.get("/models")
def models(p: Principal = Depends(admin), db: Session = Depends(get_db)):
    return [model_out(m) for m in db.execute(select(AIModel).order_by(AIModel.sort)).scalars()]


@router.put("/models/{mid}")
def upsert_model(mid: str, body: ModelIn, p: Principal = Depends(admin), db: Session = Depends(get_db)):
    m = db.get(AIModel, mid)
    data = body.model_dump()
    data["id"] = mid
    for k in ("price_in_vnd", "price_out_vnd", "price_cache_vnd", "price_per_minute_vnd"):
        data[k] = Decimal(str(data[k])) if data[k] is not None else None
    if m is None:
        m = AIModel(**data)
        db.add(m)
    else:
        for k, v in data.items():
            setattr(m, k, v)
    db.commit()
    return model_out(m)


@router.post("/models/{mid}/test")
def test_model(mid: str, p: Principal = Depends(admin), db: Session = Depends(get_db)):
    """Gửi một câu ngắn để kiểm tra key và tên model còn đúng không."""
    m = db.get(AIModel, mid)
    if m is None:
        raise HTTPException(404, "Không có model.")
    if m.kind != "chat":
        return {"ok": True, "message": "Model loại này kiểm tra khi dùng thật (tải tài liệu, ghi âm)."}
    try:
        r = llm.chat(db, p, app="api", feature="model-test", model=m.id, messages=[{"role": "user", "content": "Trả lời đúng một chữ: OK"}],
                     params={"max_tokens": 10}, use_cache=False)
        return {"ok": True, "message": f"Chạy được ({r.model_used}): {r.content[:60]}"}
    except llm.GatewayError as e:
        return {"ok": False, "message": e.message}


class RouteIn(BaseModel):
    task: str
    label: str
    primary_model: str
    fallback_model: str | None = None


@router.get("/routes")
def routes(p: Principal = Depends(admin), db: Session = Depends(get_db)):
    return [{"task": r.task, "label": r.label, "primary_model": r.primary_model, "fallback_model": r.fallback_model}
            for r in db.execute(select(RouteRule).order_by(RouteRule.sort)).scalars()]


@router.put("/routes")
def save_routes(body: list[RouteIn], p: Principal = Depends(admin), db: Session = Depends(get_db)):
    for i, r in enumerate(body):
        for mid in (r.primary_model, r.fallback_model):
            if mid and db.get(AIModel, mid) is None:
                raise HTTPException(400, f"Không có model {mid}.")
        row = db.get(RouteRule, r.task)
        if row is None:
            row = RouteRule(task=r.task, label=r.label, primary_model=r.primary_model)
            db.add(row)
        row.label, row.primary_model, row.fallback_model, row.sort = r.label, r.primary_model, r.fallback_model, (i + 1) * 10
    db.commit()
    return routes(p, db)


# ---------------- Câu lệnh mẫu ----------------
class PromptIn(BaseModel):
    scope: str = "chat"
    title: str
    text: str
    sort: int = 100


@router.post("/prompts")
def create_prompt(body: PromptIn, p: Principal = Depends(admin), db: Session = Depends(get_db)):
    pr = PromptTemplate(**body.model_dump())
    db.add(pr)
    db.commit()
    return {"id": pr.id}


@router.put("/prompts/{pid}")
def update_prompt(pid: int, body: PromptIn, p: Principal = Depends(admin), db: Session = Depends(get_db)):
    pr = db.get(PromptTemplate, pid)
    if pr is None:
        raise HTTPException(404, "Không có câu lệnh mẫu.")
    for k, v in body.model_dump().items():
        setattr(pr, k, v)
    db.commit()
    return {"id": pr.id}


@router.delete("/prompts/{pid}")
def delete_prompt(pid: int, p: Principal = Depends(admin), db: Session = Depends(get_db)):
    pr = db.get(PromptTemplate, pid)
    if pr:
        db.delete(pr)
        db.commit()
    return {"ok": True}


# ---------------- Cài đặt ----------------
@router.get("/settings")
def settings(p: Principal = Depends(admin), db: Session = Depends(get_db)):
    s = get_settings()
    configured = {
        "anthropic": bool(s.anthropic_api_key), "openai": bool(s.openai_api_key), "gemini": bool(s.gemini_api_key),
        "deepseek": bool(s.deepseek_api_key), "fpt_tts": bool(s.fpt_tts_api_key), "telegram": bool(s.telegram_bot_token),
        "messenger": bool(s.messenger_page_token and s.messenger_app_secret and s.messenger_verify_token),
        "zalo": bool(s.zalo_app_id and s.zalo_app_secret),
    }
    base = s.public_base_url.rstrip("/")
    return {"values": all_settings(db), "secrets_configured": configured,
            "webhooks": {"messenger": f"{base}/webhooks/messenger", "zalo": f"{base}/webhooks/zalo"},
            "public_base_url": base}


@router.put("/settings")
def save_settings(body: dict[str, Any], p: Principal = Depends(admin), db: Session = Depends(get_db)):
    for k, v in body.items():
        if k in DEFAULTS:
            set_setting(db, k, v)
    return settings(p, db)


# ---------------- Báo cáo & nhật ký ----------------
GROUPS = {"branch", "user", "app", "model", "day", "feature"}


def _range(frm: str | None, to: str | None) -> tuple[datetime, datetime]:
    try:
        start = datetime.fromisoformat(frm).replace(tzinfo=VN) if frm else month_start()
        end = datetime.fromisoformat(to).replace(tzinfo=VN) + timedelta(days=1) if to else day_start() + timedelta(days=1)
    except ValueError as e:
        raise HTTPException(400, "Ngày phải có dạng YYYY-MM-DD.") from e
    return start, end


@router.get("/usage")
def usage(group: str = "branch", frm: str | None = None, to: str | None = None,
          p: Principal = Depends(manager), db: Session = Depends(get_db)):
    if group not in GROUPS:
        raise HTTPException(400, f"group phải thuộc {sorted(GROUPS)}")
    start, end = _range(frm, to)
    col = {
        "branch": func.coalesce(Branch.name, "Không thuộc cơ sở"),
        "user": func.coalesce(User.name, "Hệ thống"),
        "app": UsageLog.app,
        "model": UsageLog.model_used,
        "feature": UsageLog.feature,
        "day": func.to_char(func.timezone("Asia/Ho_Chi_Minh", UsageLog.created_at), "YYYY-MM-DD"),
    }[group]
    q = (select(col.label("name"), func.count(UsageLog.id), func.coalesce(func.sum(UsageLog.input_tokens), 0),
                func.coalesce(func.sum(UsageLog.output_tokens), 0), func.coalesce(func.sum(UsageLog.cost_vnd), 0),
                func.coalesce(func.sum(case((UsageLog.cache_hit.is_(True), 1), else_=0)), 0))
         .select_from(UsageLog)
         .join(Branch, Branch.id == UsageLog.branch_id, isouter=True)
         .join(User, User.id == UsageLog.user_id, isouter=True)
         .where(UsageLog.created_at >= start, UsageLog.created_at < end, UsageLog.status == "ok")
         .group_by(col).order_by(func.coalesce(func.sum(UsageLog.cost_vnd), 0).desc() if group != "day" else col))
    q = _branch_scope(q, p, UsageLog.branch_id)
    rows = db.execute(q).all()
    return {"from": start.date().isoformat(), "to": (end - timedelta(days=1)).date().isoformat(), "group": group,
            "rows": [{"name": n, "calls": int(c), "input_tokens": int(i), "output_tokens": int(o), "cost_vnd": float(v), "cache_hits": int(h)}
                     for n, c, i, o, v, h in rows]}


@router.get("/logs")
def logs(limit: int = 50, offset: int = 0, user_id: int | None = None, app: str | None = None, status: str | None = None,
         p: Principal = Depends(manager), db: Session = Depends(get_db)):
    q = (select(UsageLog, User.name, Branch.name).join(User, User.id == UsageLog.user_id, isouter=True)
         .join(Branch, Branch.id == UsageLog.branch_id, isouter=True).order_by(UsageLog.id.desc()))
    q = _branch_scope(q, p, UsageLog.branch_id)
    if user_id:
        q = q.where(UsageLog.user_id == user_id)
    if app:
        q = q.where(UsageLog.app == app)
    if status:
        q = q.where(UsageLog.status == status)
    rows = db.execute(q.limit(min(limit, 200)).offset(offset)).all()
    return [{
        "id": r.id, "time": r.created_at.astimezone(VN).strftime("%d/%m %H:%M:%S"), "user": un or "Hệ thống", "branch": bn,
        "app": r.app, "feature": r.feature, "model_requested": r.model_requested, "model_used": r.model_used, "task": r.task,
        "input_tokens": r.input_tokens, "output_tokens": r.output_tokens, "cached_tokens": r.cached_tokens, "units": r.units,
        "cost_vnd": float(r.cost_vnd), "cache_hit": r.cache_hit, "latency_ms": r.latency_ms, "status": r.status,
        "error": r.error, "excerpt": r.excerpt,
    } for r, un, bn in rows]
