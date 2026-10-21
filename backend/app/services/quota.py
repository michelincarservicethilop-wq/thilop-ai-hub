"""Hạn mức: công ty → cơ sở → người dùng → key. Chạm trần thì chặn tới 0h (ngày) hoặc đầu tháng sau."""
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Branch, UsageLog
from .principal import Principal
from .settings_store import get_setting
from .timeutil import day_start, month_start


class QuotaExceeded(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass
class Spend:
    used: Decimal
    limit: int | None

    @property
    def pct(self) -> int | None:
        if not self.limit:
            return None
        return int(self.used * 100 / Decimal(self.limit))


def spent(db: Session, since: datetime, *, user_id: int | None = None, branch_id: int | None = None, api_key_id: int | None = None) -> Decimal:
    q = select(func.coalesce(func.sum(UsageLog.cost_vnd), 0)).where(UsageLog.created_at >= since)
    if user_id is not None:
        q = q.where(UsageLog.user_id == user_id)
    if branch_id is not None:
        q = q.where(UsageLog.branch_id == branch_id)
    if api_key_id is not None:
        q = q.where(UsageLog.api_key_id == api_key_id)
    return Decimal(db.execute(q).scalar_one())


def checks(db: Session, p: Principal) -> list[tuple[str, int, str, Spend]]:
    """Danh sách (phạm vi, id, kỳ, mức dùng) cần so với trần."""
    out: list[tuple[str, int, str, Spend]] = []
    m0, d0 = month_start(), day_start()
    company_m = get_setting(db, "company_monthly_limit_vnd")
    company_d = get_setting(db, "company_daily_limit_vnd")
    if company_m:
        out.append(("company", 0, "month", Spend(spent(db, m0), int(company_m))))
    if company_d:
        out.append(("company", 0, "day", Spend(spent(db, d0), int(company_d))))
    if p.branch_id:
        b = db.get(Branch, p.branch_id)
        if b and b.monthly_limit_vnd:
            out.append(("branch", b.id, "month", Spend(spent(db, m0, branch_id=b.id), b.monthly_limit_vnd)))
        if b and b.daily_limit_vnd:
            out.append(("branch", b.id, "day", Spend(spent(db, d0, branch_id=b.id), b.daily_limit_vnd)))
    u = p.user
    if u.monthly_limit_vnd:
        out.append(("user", u.id, "month", Spend(spent(db, m0, user_id=u.id), u.monthly_limit_vnd)))
    if u.daily_limit_vnd:
        out.append(("user", u.id, "day", Spend(spent(db, d0, user_id=u.id), u.daily_limit_vnd)))
    k = p.api_key
    if k and k.daily_limit_vnd:
        out.append(("key", k.id, "day", Spend(spent(db, d0, api_key_id=k.id), k.daily_limit_vnd)))
    return out


SCOPE_VN = {"company": "công ty", "branch": "cơ sở", "user": "tài khoản", "key": "key"}
PERIOD_VN = {"month": "tháng", "day": "ngày"}


def ensure_quota(db: Session, p: Principal) -> None:
    for scope, _id, period, s in checks(db, p):
        if s.limit and s.used >= s.limit:
            until = "0h ngày mai (giờ VN)" if period == "day" else "đầu tháng sau"
            raise QuotaExceeded(f"Đã chạm hạn mức {PERIOD_VN[period]} của {SCOPE_VN[scope]} ({int(s.used):,}đ / {s.limit:,}đ). Mở lại lúc {until} hoặc nhờ admin nâng hạn mức.")


def my_summary(db: Session, p: Principal) -> dict:
    m0, d0 = month_start(), day_start()
    return {
        "month_used": float(spent(db, m0, user_id=p.user.id)),
        "month_limit": p.user.monthly_limit_vnd,
        "day_used": float(spent(db, d0, user_id=p.user.id)),
        "day_limit": p.user.daily_limit_vnd,
    }
