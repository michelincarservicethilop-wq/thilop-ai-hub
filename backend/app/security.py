import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from .config import get_settings

KEY_PREFIX = "tl-"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(user_id: int) -> str:
    s = get_settings()
    payload = {"sub": str(user_id), "exp": datetime.now(UTC) + timedelta(hours=s.jwt_hours)}
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> int | None:
    try:
        data = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
        return int(data["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def new_api_key() -> tuple[str, str, str]:
    """Trả về (key đầy đủ, prefix hiển thị, hash lưu CSDL). Key đầy đủ chỉ hiện một lần."""
    raw = KEY_PREFIX + secrets.token_urlsafe(32)
    return raw, raw[:7], hash_key(raw)


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
