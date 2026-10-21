"""Chuyển chữ thành giọng đọc (MP3): FPT.AI (giọng Việt 3 miền) và OpenAI.

Đây là chỗ DUY NHẤT gọi hãng ngoài không qua services/llm.py (llm.py chưa có hàm giọng đọc);
hạn mức và nhật ký chi phí do api/studio.py tự kiểm tra/ghi.
"""
from __future__ import annotations

import logging
import time

import httpx

from ..config import get_settings

log = logging.getLogger("hub.tts")

FPT_URL = "https://api.fpt.ai/hmi/tts/v5"
OPENAI_TTS_MODEL = "openai/gpt-4o-mini-tts"
OPENAI_NOTE = "(OpenAI ngừng 06/01/2027)"  # OpenAI tắt các model TTS này ngày 06/01/2027

# Danh sách giọng và cách gọi API FPT.AI TTS v5 — cần kiểm tra lại với tài liệu FPT.AI trước khi chạy thật
# (FPT có thể đổi/thêm giọng hoặc đổi API).
FPT_VOICES = [
    ("banmai", "Ban Mai · Nữ miền Bắc"),
    ("thuminh", "Thu Minh · Nữ miền Bắc"),
    ("leminh", "Lê Minh · Nam miền Bắc"),
    ("myan", "Mỹ An · Nữ miền Trung"),
    ("giahuy", "Gia Huy · Nam miền Trung"),
    ("lannhi", "Lan Nhi · Nữ miền Nam"),
    ("linhsan", "Linh San · Nữ miền Nam"),
    ("minhquang", "Minh Quang · Nam miền Nam"),
]
OPENAI_VOICES = [
    ("nova", "Nova · Nữ"),
    ("shimmer", "Shimmer · Nữ"),
    ("alloy", "Alloy · Trung tính"),
    ("onyx", "Onyx · Nam"),
]

# MP3 giả (1 khung im lặng) dùng ở chế độ thử
MOCK_MP3 = b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x64" + b"\x00" * 413


class TTSError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def list_voices() -> list[dict]:
    s = get_settings()
    out = [{"id": f"fpt:{v}", "label": label, "provider": "fpt", "available": bool(s.fpt_tts_api_key)}
           for v, label in FPT_VOICES]
    out += [{"id": f"openai:{v}", "label": f"{label} {OPENAI_NOTE}", "provider": "openai",
             "available": bool(s.openai_api_key)} for v, label in OPENAI_VOICES]
    return out


def find_voice(voice_id: str) -> dict | None:
    return next((v for v in list_voices() if v["id"] == voice_id), None)


def _fpt(voice: str, text: str) -> bytes:
    key = get_settings().fpt_tts_api_key
    try:
        r = httpx.post(FPT_URL, headers={"api-key": key, "voice": voice, "speed": ""}, content=text.encode("utf-8"), timeout=30)
        d = r.json()
    except Exception as e:  # noqa: BLE001
        raise TTSError(f"Không gọi được FPT.AI: {e}") from e
    url = d.get("async")
    if r.status_code != 200 or d.get("error") not in (0, None) or not url:
        raise TTSError(f"FPT.AI từ chối: {d.get('message') or r.text[:200]}")
    # File MP3 chỉ tải được sau vài giây → hỏi lại tối đa ~40 giây
    deadline = time.time() + 40
    while time.time() < deadline:
        time.sleep(2)
        try:
            a = httpx.get(url, timeout=15, follow_redirects=True)
        except Exception:  # noqa: BLE001
            continue
        if a.status_code == 200 and len(a.content) > 100 and "html" not in a.headers.get("content-type", ""):
            return a.content
    raise TTSError("FPT.AI tạo giọng đọc quá lâu, vui lòng thử lại.", 504)


def _openai(voice: str, text: str) -> bytes:
    import litellm

    try:
        resp = litellm.speech(model=OPENAI_TTS_MODEL, voice=voice, input=text, api_key=get_settings().openai_api_key)
    except Exception as e:  # noqa: BLE001
        raise TTSError(f"OpenAI tạo giọng đọc lỗi: {e}") from e
    data = getattr(resp, "content", None)
    if data is None and hasattr(resp, "read"):
        data = resp.read()
    if not data:
        raise TTSError("OpenAI không trả về âm thanh.")
    return data


def synthesize(voice_id: str, text: str) -> bytes:
    """voice_id dạng 'fpt:banmai' hoặc 'openai:nova'. Trả về nội dung MP3."""
    v = find_voice(voice_id)
    if v is None:
        raise TTSError("Không có giọng đọc này.", 400)
    if get_settings().mock_llm:
        return MOCK_MP3
    if not v["available"]:
        raise TTSError("Chưa cài key cho nhà cung cấp giọng đọc này.", 400)
    provider, name = voice_id.split(":", 1)
    return _fpt(name, text) if provider == "fpt" else _openai(name, text)
