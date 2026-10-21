"""Tiến trình chạy nền: `python -m app.worker`.

Lấy việc trong bảng jobs (index_document, meeting), chạy lần lượt; nhiều worker chạy song song vẫn an toàn
nhờ SELECT ... FOR UPDATE SKIP LOCKED. Mỗi 30 phút kiểm tra và làm mới token Zalo OA.
"""
from __future__ import annotations

import logging
import os
import signal
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .channels import zalo
from .db import session_factory
from .models import Job, User
from .seed import init_db
from .services import llm, rag
from .services.jsonutil import parse_json_object
from .services.principal import Principal
from .services.storage import abs_path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("hub.worker")

POLL_SECONDS = 2
ZALO_REFRESH_SECONDS = 30 * 60

MEETING_SYSTEM = (
    "Bạn là thư ký cuộc họp của Thi Lốp. Từ bản ghi lời nói (có thể lẫn lỗi nhận dạng), trả về DUY NHẤT một JSON:\n"
    '{"summary": "tóm tắt 5–10 câu", "decisions": ["quyết định đã chốt"], '
    '"actions": [{"task": "việc cần làm", "owner": "người phụ trách hoặc \\"\\"", "due": "hạn hoặc \\"\\""}]}\n'
    "Chỉ ghi điều có trong bản ghi, không bịa tên người hay hạn chót. Viết tiếng Việt."
)


# ---------------- Xử lý từng loại việc ----------------
def _audio_seconds(path: str) -> float:
    try:
        import mutagen  # không bắt buộc cài

        f = mutagen.File(path)
        if f is not None and f.info and f.info.length:
            return float(f.info.length)
    except Exception:  # noqa: BLE001
        pass
    # Không đọc được độ dài: ước theo dung lượng (~128 kbps = 16 KB mỗi giây) để vẫn tính phí, không để 0đ
    try:
        return os.path.getsize(path) / 16000
    except OSError:
        return 0.0


def run_meeting(db: Session, job: Job) -> dict[str, Any]:
    user = db.get(User, job.created_by) if job.created_by else None
    if user is None:
        raise ValueError("Không xác định được người tạo việc.")
    p = Principal(user=user)
    path = str(abs_path(job.payload["path"]))
    transcript = llm.transcribe(db, p, path, seconds=_audio_seconds(path), app="apps", feature="meeting")
    if not transcript.strip():
        return {"transcript": "", "summary": "Không nhận dạng được lời nói trong ghi âm.", "decisions": [], "actions": []}
    r = llm.chat(db, p, app="apps", feature="meeting", task_hint="writing", use_cache=False, messages=[
        {"role": "system", "content": MEETING_SYSTEM},
        {"role": "user", "content": "Bản ghi cuộc họp:\n" + transcript[:60000]},
    ])
    data = parse_json_object(r.content)
    if data is None:  # model không trả JSON → giữ nguyên văn làm tóm tắt
        return {"transcript": transcript, "summary": r.content.strip(), "decisions": [], "actions": []}
    actions = []
    for a in data.get("actions") or []:
        if isinstance(a, dict):
            actions.append({"task": str(a.get("task") or ""), "owner": str(a.get("owner") or ""), "due": str(a.get("due") or "")})
        elif a:
            actions.append({"task": str(a), "owner": "", "due": ""})
    return {"transcript": transcript, "summary": str(data.get("summary") or ""),
            "decisions": [str(x) for x in (data.get("decisions") or []) if x], "actions": actions}


def run_index(db: Session, job: Job) -> dict[str, Any]:
    n = rag.index_document(db, int(job.payload["document_id"]))
    return {"chunks": n}


HANDLERS = {"index_document": run_index, "meeting": run_meeting}


def process_one(db: Session) -> bool:
    """Lấy 1 việc đang chờ và chạy. Trả về False nếu không còn việc."""
    job = db.execute(
        select(Job).where(Job.status == "queued").order_by(Job.id).limit(1).with_for_update(skip_locked=True)
    ).scalar_one_or_none()
    if job is None:
        db.rollback()
        return False
    job.status = "running"
    db.commit()  # nhả khoá; việc đã là running nên worker khác không lấy nữa
    jid, kind = job.id, job.kind
    log.info("Bắt đầu việc #%s (%s)", jid, kind)
    try:
        handler = HANDLERS.get(kind)
        if handler is None:
            raise ValueError(f"Không biết loại việc '{kind}'.")
        result = handler(db, job)
        job = db.get(Job, jid)
        job.status, job.result, job.error = "done", result, ""
        db.commit()
        log.info("Xong việc #%s", jid)
    except Exception as e:  # noqa: BLE001
        db.rollback()
        msg = e.message if isinstance(e, llm.GatewayError) else str(e)
        log.warning("Việc #%s lỗi: %s", jid, msg)
        job = db.get(Job, jid)
        if job is not None:
            job.status, job.error = "error", msg[:2000]
            db.commit()
    return True


# ---------------- Vòng lặp chính ----------------
_stop = False


def _handle_stop(*_):
    global _stop
    _stop = True
    log.info("Nhận tín hiệu dừng, sẽ thoát sau việc đang chạy")


def fail_stale_jobs(db: Session, hours: int = 2) -> int:
    """Việc 'running' quá lâu (worker bị tắt giữa chừng) → báo lỗi để người dùng biết mà gửi lại."""
    cutoff = datetime.now(UTC) - timedelta(hours=hours)
    rows = db.execute(select(Job).where(Job.status == "running", Job.updated_at < cutoff)).scalars().all()
    for j in rows:
        j.status, j.error = "error", "Worker dừng giữa chừng, vui lòng gửi lại."
    db.commit()
    return len(rows)


def main() -> None:
    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)
    init_db()  # chạy lặp lại vẫn an toàn
    with session_factory()() as db:
        fail_stale_jobs(db)
    log.info("Worker đã sẵn sàng")
    last_zalo = 0.0
    while not _stop:
        try:
            with session_factory()() as db:
                if time.time() - last_zalo >= ZALO_REFRESH_SECONDS:
                    last_zalo = time.time()
                    try:
                        zalo.refresh_if_needed(db)
                    except Exception as e:  # noqa: BLE001
                        log.warning("Làm mới token Zalo lỗi: %s", e)
                did = process_one(db)
        except Exception as e:  # noqa: BLE001 — mất kết nối CSDL... thì chờ rồi thử lại
            log.warning("Lỗi vòng lặp worker: %s", e)
            did = False
        if not did:
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
