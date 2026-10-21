"""Tài liệu cho Hỏi tài liệu và bot trả lời khách: tải lên, đổi tên, bật/tắt dùng cho khách, xoá."""
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import manager, web_user
from ..models import Document, Job
from ..services import storage
from ..services.principal import Principal
from ..services.rag import ALLOWED_EXT
from ..services.timeutil import VN

router = APIRouter(prefix="/api", tags=["documents"])
log = logging.getLogger("hub.documents")

MAX_BYTES = 20 * 1024 * 1024


def doc_out(d: Document) -> dict:
    return {
        "id": d.id, "title": d.title, "filename": d.filename, "public_kb": d.public_kb, "status": d.status,
        "error": d.error, "pages": d.pages, "chunks": d.chunks,
        "created_at": d.created_at.astimezone(VN).isoformat() if d.created_at else None,
    }


@router.get("/documents")
def list_documents(p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    rows = db.execute(select(Document).order_by(Document.id.desc())).scalars()
    return [doc_out(d) for d in rows]


@router.post("/documents")
def upload_document(
    file: UploadFile = File(...),
    title: str = Form(""),
    public_kb: bool = Form(True),
    p: Principal = Depends(manager),
    db: Session = Depends(get_db),
):
    filename = file.filename or "tai-lieu"
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, "Chỉ nhận file PDF, Word (.docx), TXT, MD, CSV hoặc Excel (.xlsx).")
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File quá lớn (tối đa 20 MB).")
    if not data:
        raise HTTPException(400, "File trống.")
    rel = storage.save_bytes(data, filename, folder="documents")
    d = Document(title=(title.strip() or Path(filename).stem)[:200], filename=filename[:300], path=rel,
                 public_kb=public_kb, status="queued", created_by=p.user.id)
    db.add(d)
    db.flush()
    db.add(Job(kind="index_document", payload={"document_id": d.id}, created_by=p.user.id))
    db.commit()
    db.refresh(d)
    return doc_out(d)


class DocPatch(BaseModel):
    title: str | None = None
    public_kb: bool | None = None


def _get(db: Session, did: int) -> Document:
    d = db.get(Document, did)
    if d is None:
        raise HTTPException(404, "Không tìm thấy tài liệu.")
    return d


@router.patch("/documents/{did}")
def patch_document(did: int, body: DocPatch, p: Principal = Depends(manager), db: Session = Depends(get_db)):
    d = _get(db, did)
    if body.title is not None:
        if not body.title.strip():
            raise HTTPException(400, "Tên tài liệu không được trống.")
        d.title = body.title.strip()[:200]
    if body.public_kb is not None:
        d.public_kb = body.public_kb
    db.commit()
    return doc_out(d)


@router.delete("/documents/{did}")
def delete_document(did: int, p: Principal = Depends(manager), db: Session = Depends(get_db)):
    d = _get(db, did)
    rel = d.path
    db.delete(d)  # các đoạn (doc_chunks) tự xoá theo khoá ngoại ON DELETE CASCADE
    db.commit()
    try:
        storage.abs_path(rel).unlink(missing_ok=True)
    except (OSError, ValueError) as e:
        log.warning("Không xoá được file %s: %s", rel, e)
    return {"ok": True}
