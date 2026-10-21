"""Mốc thời gian theo giờ Việt Nam (hạn mức ngày/tháng reset lúc 0h giờ VN)."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

VN = ZoneInfo("Asia/Ho_Chi_Minh")


def now_vn() -> datetime:
    return datetime.now(VN)


def day_start(ts: datetime | None = None) -> datetime:
    ts = ts or now_vn()
    return ts.astimezone(VN).replace(hour=0, minute=0, second=0, microsecond=0)


def month_start(ts: datetime | None = None) -> datetime:
    return day_start(ts).replace(day=1)


def day_key(ts: datetime | None = None) -> str:
    return (ts or now_vn()).astimezone(VN).strftime("%Y-%m-%d")


def month_key(ts: datetime | None = None) -> str:
    return (ts or now_vn()).astimezone(VN).strftime("%Y-%m")


def days_ago(n: int) -> datetime:
    return day_start() - timedelta(days=n)
