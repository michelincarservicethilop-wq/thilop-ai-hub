from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import web_user
from ..models import AlertSent, Branch, CustomerMessage, UsageLog, User
from ..services.principal import Principal
from ..services.quota import spent
from ..services.settings_store import get_setting
from ..services.timeutil import VN, day_start, days_ago, month_start

router = APIRouter(prefix="/api", tags=["overview"])


def _scope(q, p: Principal):
    """Admin xem toàn công ty, quản lý xem cơ sở mình, nhân viên xem của mình."""
    if p.is_admin:
        return q
    if p.user.role == "manager" and p.branch_id:
        return q.where(UsageLog.branch_id == p.branch_id)
    return q.where(UsageLog.user_id == p.user.id)


@router.get("/overview")
def overview(p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    m0, d0 = month_start(), day_start()
    if p.is_admin:
        month_used, month_limit = spent(db, m0), get_setting(db, "company_monthly_limit_vnd")
        scope_label = "Toàn công ty"
    elif p.user.role == "manager" and p.branch_id:
        b = db.get(Branch, p.branch_id)
        month_used, month_limit = spent(db, m0, branch_id=p.branch_id), b.monthly_limit_vnd if b else None
        scope_label = f"Cơ sở {b.name}" if b else "Cơ sở"
    else:
        month_used, month_limit = spent(db, m0, user_id=p.user.id), p.user.monthly_limit_vnd
        scope_label = "Của anh/chị"

    today = _scope(select(
        func.count(UsageLog.id),
        func.coalesce(func.sum(case((UsageLog.cache_hit.is_(True), 1), else_=0)), 0),
    ).where(UsageLog.created_at >= d0, UsageLog.status == "ok"), p)
    calls_today, cache_hits = db.execute(today).one()

    by_app_q = _scope(select(UsageLog.app, func.count(UsageLog.id), func.coalesce(func.sum(UsageLog.cost_vnd), 0))
                      .where(UsageLog.created_at >= d0, UsageLog.status == "ok").group_by(UsageLog.app), p)
    calls_by_app = {a: int(n) for a, n, _ in db.execute(by_app_q).all()}

    month_by_app_q = _scope(select(UsageLog.app, func.coalesce(func.sum(UsageLog.cost_vnd), 0))
                            .where(UsageLog.created_at >= m0).group_by(UsageLog.app), p)
    by_app = [{"app": a, "cost_vnd": float(c)} for a, c in db.execute(month_by_app_q).all()]

    active_users = db.execute(_scope(select(func.count(func.distinct(UsageLog.user_id))).where(UsageLog.created_at >= days_ago(7)), p)).scalar_one()
    total_users = db.execute(select(func.count(User.id)).where(User.active.is_(True), User.role != "machine")).scalar_one()

    by_branch = []
    if p.is_manager:
        rows = db.execute(
            select(Branch.id, Branch.name, Branch.monthly_limit_vnd, func.coalesce(func.sum(UsageLog.cost_vnd), 0))
            .select_from(Branch)
            .join(UsageLog, (UsageLog.branch_id == Branch.id) & (UsageLog.created_at >= m0), isouter=True)
            .where(Branch.active.is_(True))
            .group_by(Branch.id).order_by(Branch.id)
        ).all()
        by_branch = [{"id": i, "name": n, "limit_vnd": lim, "used_vnd": float(u)} for i, n, lim, u in rows
                     if p.is_admin or i == p.branch_id]

    recent_q = _scope(select(UsageLog, User.name).join(User, User.id == UsageLog.user_id, isouter=True)
                      .order_by(UsageLog.id.desc()).limit(10), p)
    recent = [{
        "time": r.created_at.astimezone(VN).strftime("%H:%M"), "user": name or "Hệ thống", "app": r.app, "feature": r.feature,
        "model": r.model_used, "tokens": r.input_tokens + r.output_tokens, "cost_vnd": float(r.cost_vnd),
        "cache_hit": r.cache_hit, "status": r.status,
    } for r, name in db.execute(recent_q).all()]

    inbox = {"messages_today": 0, "bot_replies": 0, "handoffs": 0}
    if p.is_manager:
        rows = db.execute(select(CustomerMessage.sender, func.count(CustomerMessage.id))
                          .where(CustomerMessage.created_at >= d0).group_by(CustomerMessage.sender)).all()
        counts = dict(rows)
        inbox = {"messages_today": int(counts.get("customer", 0)), "bot_replies": int(counts.get("bot", 0)),
                 "handoffs": int(db.execute(select(func.count(CustomerMessage.id)).where(
                     CustomerMessage.created_at >= d0, CustomerMessage.sender == "system",
                     CustomerMessage.text.like("Chuyển cho nhân viên%"))).scalar_one())}

    alerts = []
    if p.is_manager:
        alerts = [{"time": a.created_at.astimezone(VN).strftime("%d/%m %H:%M"), "level": a.level, "message": a.message}
                  for a in db.execute(select(AlertSent).order_by(AlertSent.id.desc()).limit(5)).scalars()]

    return {
        "scope": scope_label,
        "month_used_vnd": float(month_used), "month_limit_vnd": month_limit,
        "calls_today": int(calls_today), "calls_by_app": calls_by_app,
        "cache_rate_today": round(int(cache_hits) * 100 / int(calls_today)) if calls_today else 0,
        "active_users_7d": int(active_users), "total_users": int(total_users),
        "by_app": by_app, "by_branch": by_branch, "recent": recent, "inbox": inbox, "alerts": alerts,
    }
