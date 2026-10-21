"""Redis cho cache và giới hạn tốc độ. Không kết nối được Redis thì dùng bộ nhớ tạm (đủ cho chạy thử)."""
import threading
import time

import redis

from ..config import get_settings


class _MemoryKV:
    def __init__(self) -> None:
        self._d: dict[str, tuple[str, float | None]] = {}
        self._lock = threading.Lock()

    def _alive(self, k: str) -> bool:
        v = self._d.get(k)
        if v is None:
            return False
        if v[1] is not None and v[1] < time.time():
            self._d.pop(k, None)
            return False
        return True

    def get(self, k: str) -> str | None:
        with self._lock:
            return self._d[k][0] if self._alive(k) else None

    def set(self, k: str, v: str, ex: int | None = None) -> None:
        with self._lock:
            self._d[k] = (v, time.time() + ex if ex else None)

    def incr_window(self, k: str, ex: int) -> int:
        with self._lock:
            n = int(self._d[k][0]) + 1 if self._alive(k) else 1
            exp = self._d[k][1] if self._alive(k) else time.time() + ex
            self._d[k] = (str(n), exp)
            return n

    def delete(self, k: str) -> None:
        with self._lock:
            self._d.pop(k, None)


class _RedisKV:
    def __init__(self, url: str) -> None:
        self.r = redis.Redis.from_url(url, decode_responses=True, socket_connect_timeout=1, socket_timeout=2)
        self.r.ping()

    def get(self, k: str) -> str | None:
        return self.r.get(k)

    def set(self, k: str, v: str, ex: int | None = None) -> None:
        self.r.set(k, v, ex=ex)

    def incr_window(self, k: str, ex: int) -> int:
        p = self.r.pipeline()
        p.incr(k)
        p.expire(k, ex, nx=True)
        n, _ = p.execute()
        return int(n)

    def delete(self, k: str) -> None:
        self.r.delete(k)


_kv = None


def kv():
    global _kv
    if _kv is None:
        try:
            _kv = _RedisKV(get_settings().redis_url)
        except Exception:  # noqa: BLE001
            _kv = _MemoryKV()
    return _kv


def reset_kv(memory: bool = False) -> None:
    global _kv
    _kv = _MemoryKV() if memory else None
