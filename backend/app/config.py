"""Cấu hình đọc từ biến môi trường (.env). Bí mật (key hãng AI, token kênh chat) chỉ nằm ở đây."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Hệ thống
    app_name: str = "Thi Lốp AI Hub"
    public_base_url: str = "http://localhost:8080"  # ví dụ https://ai.thilop.vn
    database_url: str = "postgresql+psycopg://hub:hub@db:5432/hub"
    redis_url: str = "redis://redis:6379/0"
    jwt_secret: str = "doi-chuoi-nay-khi-cai-dat"
    jwt_hours: int = 12
    data_dir: str = "/data"
    embed_dim: int = 1536

    # Tài khoản admin tạo lần đầu
    admin_email: str = "admin@thilop.vn"
    admin_password: str = "doi-mat-khau-ngay"
    admin_name: str = "Quản trị"

    # Key các hãng AI (LiteLLM tự đọc các biến này)
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    gemini_api_key: str = ""
    deepseek_api_key: str = ""

    # Giọng đọc FPT.AI
    fpt_tts_api_key: str = ""

    # Telegram (cảnh báo hạn mức, ca chuyển người)
    telegram_bot_token: str = ""

    # Messenger (fanpage)
    messenger_page_id: str = ""
    messenger_page_token: str = ""
    messenger_app_secret: str = ""
    messenger_verify_token: str = ""
    graph_api_version: str = "v21.0"

    # Zalo OA
    zalo_app_id: str = ""
    zalo_app_secret: str = ""
    zalo_oa_secret_key: str = ""
    zalo_refresh_token: str = ""  # chỉ dùng lần đầu; sau đó Hub tự lưu token mới vào CSDL

    # Chế độ thử: không gọi hãng AI thật, trả lời giả lập (dùng khi chạy test)
    mock_llm: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
