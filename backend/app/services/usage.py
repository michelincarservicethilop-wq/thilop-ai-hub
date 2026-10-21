"""Ghi nhật ký từng lượt gọi và gửi cảnh báo khi chạm 80% / 100% hạn mức."""
import logging
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AlertSent, Branch, UsageLog
from . import telegram
from .principal import Principal
from .quota import PERIOD_VN, SCOPE_VN, checks
from .settings_store import get_setting
from .timeutil import day_key, month_key

log = logging.getLogger("hub.usage")


def log_usage(
    db: Session,
    p: Principal | None,
    *,
    app: str,
    feature: str = "",
    model_requested: str = "",
    model_used: str = "",
    task: str = "",
    input_tokens: int = 0,
    output_tokens: int = 0,
    cached_tokens: int = 0,
    units: int = 0,
    cost_vnd: Decimal | float = 0,
    cache_hit: bool = False,
    latency_ms: int = 0,
    status: str = "ok",
    error: str = "",
    excerpt: str = "",
    branch_id: int | None = None,
) -> UsageLog:
    store = bool(get_setting(db, "store_content"))
    row = UsageLog(
        user_id=p.user.id if p else None,
        api_key_id=p.api_key.id if p and p.api_key else None,
        branch_id=branch_id if branch_id is not None else (p.branch_id if p else None),
        app=app,
        feature=feature,
        model_requested=model_requested,
        model_used=model_used,
        task=task,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cached_tokens=cached_tokens,
        units=units,
        cost_vnd=Decimal(str(cost_vnd)),
        cache_hit=cache_hit,
        latency_ms=latency_ms,
        status=status,
        error=error[:2000],
        excerpt=excerpt[:500] if store else "",
    )
    db.add(row)
    db.commit()
    if p and status == "ok" and row.cost_vnd > 0:
        try:
            check_alerts(db, p)
        except Exception as e:  # noqa: BLE001
            log.warning("Lỗi kiểm tra cảnh báo: %s", e)
    return row


def check_alerts(db: Session, p: Principal) -> None:
    levels = sorted(get_setting(db, "alert_levels") or [80, 100], reverse=True)
    admin_chat = get_setting(db, "telegram_admin_chat_id") or ""
    for scope, sid, period, s in checks(db, p):
        pct = s.pct
        if pct is None:
            continue
        level = next((lv for lv in levels if pct >= lv), None)
        if level is None:
            continue
        pkey = month_key() if period == "month" else day_key()
        exists = db.execute(
            select(AlertSent.id).where(
                AlertSent.scope == scope, AlertSent.scope_id == sid, AlertSent.period == pkey, AlertSent.level == level
            )
        ).first()
        if exists:
            continue
        name = {"company": "Công ty", "user": p.user.name, "key": p.api_key.name if p.api_key else "", "branch": ""}[scope]
        chat_ids = {admin_chat}
        if scope == "branch":
            b = db.get(Branch, sid)
            name = b.name if b else f"Cơ sở {sid}"
            if b and b.telegram_chat_id:
                chat_ids.add(b.telegram_chat_id)
        msg = f"⚠️ {SCOPE_VN[scope].capitalize()} {name}: đã dùng {pct}% hạn mức {PERIOD_VN[period]} ({int(s.used):,}đ / {s.limit:,}đ)."
        if level >= 100:
            msg += " Các lệnh gọi đang bị chặn."
        db.add(AlertSent(scope=scope, scope_id=sid, period=pkey, level=level, message=msg))
        db.commit()
        for cid in chat_ids:
            telegram.notify(cid, msg)
