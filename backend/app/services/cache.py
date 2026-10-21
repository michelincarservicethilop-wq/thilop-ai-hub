"""Cache câu trả lời trùng: cùng model, cùng nội dung hỏi thì trả lại kết quả cũ, không tốn token."""
import hashlib
import json
from typing import Any

from .kv import kv


def cache_key(model_id: str, messages: list[dict[str, Any]], params: dict[str, Any]) -> str:
    body = json.dumps({"m": model_id, "msgs": messages, "p": params}, sort_keys=True, ensure_ascii=False, default=str)
    return "resp:" + hashlib.sha256(body.encode()).hexdigest()


def get(key: str) -> dict | None:
    raw = kv().get(key)
    return json.loads(raw) if raw else None


def put(key: str, value: dict, ttl_hours: float) -> None:
    if ttl_hours and ttl_hours > 0:
        kv().set(key, json.dumps(value, ensure_ascii=False), ex=int(ttl_hours * 3600))
