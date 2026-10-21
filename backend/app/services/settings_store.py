"""Cài đặt chỉnh được trong trang quản trị (lưu CSDL). Bí mật không lưu ở đây mà ở .env."""
from typing import Any

from sqlalchemy.orm import Session

from ..models import Setting

DEFAULTS: dict[str, Any] = {
    "usd_vnd_rate": 26000,
    "company_monthly_limit_vnd": 8_000_000,
    "company_daily_limit_vnd": None,
    "store_content": True,  # lưu trích nội dung vào nhật ký
    "cache_ttl_hours": 24,
    "web_rpm_limit": 30,  # số lượt mỗi phút cho người dùng trên web
    "telegram_admin_chat_id": "",
    "alert_levels": [80, 100],
    # Hộp thư khách hàng
    "inbox": {
        "messenger_enabled": True,
        "zalo_enabled": True,
        "night_reply": True,
        "business_hours": {"start": "07:30", "end": "18:00"},
        "default_branch_id": None,
        "greeting": "Chào anh/chị, em là trợ lý tự động của Thi Lốp. Em trả lời giá, giờ mở cửa, đặt lịch; việc cần nhân viên em sẽ chuyển ngay ạ.",
        "handoff_message": "Dạ em đã chuyển cho nhân viên cơ sở, anh/chị đợi em ít phút ạ.",
        "rules": {"complaint": True, "offprice": True, "askhuman": True, "unsure": True},
        "bot_model": "auto",
    },
    "tts": {"default_voice": "fpt:banmai", "price_per_1000_chars_vnd": 0},
}


def get_setting(db: Session, key: str) -> Any:
    row = db.get(Setting, key)
    default = DEFAULTS.get(key)
    if row is None:
        return default
    if isinstance(default, dict) and isinstance(row.value, dict):
        merged = dict(default)
        merged.update(row.value)
        return merged
    return row.value


def set_setting(db: Session, key: str, value: Any) -> None:
    row = db.get(Setting, key)
    if row is None:
        db.add(Setting(key=key, value=value))
    else:
        row.value = value
    db.commit()


def all_settings(db: Session) -> dict[str, Any]:
    return {k: get_setting(db, k) for k in DEFAULTS}
