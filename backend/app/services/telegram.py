"""Gửi thông báo Telegram (cảnh báo hạn mức, ca chuyển người). Lỗi gửi không làm hỏng việc chính."""
import logging
import threading

import httpx

from ..config import get_settings

log = logging.getLogger("hub.telegram")


def _send(chat_id: str, text: str) -> None:
    token = get_settings().telegram_bot_token
    if not token or not chat_id:
        return
    try:
        httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "disable_web_page_preview": True},
            timeout=10,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("Không gửi được Telegram: %s", e)


def notify(chat_id: str, text: str) -> None:
    if not chat_id:
        return
    threading.Thread(target=_send, args=(chat_id, text), daemon=True).start()
