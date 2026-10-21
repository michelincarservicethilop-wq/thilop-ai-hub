from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import web_user
from ..models import Job
from ..services.principal import Principal
from ..services.storage import abs_path, top_folder

router = APIRouter(prefix="/api", tags=["files"])


@router.get("/files/{rel:path}")
def get_file(rel: str, p: Principal = Depends(web_user)):
    """Tải file do Hub tạo (giọng đọc, Excel...). Thẻ <audio> dùng được với ?token=..."""
    try:
        path = abs_path(rel)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    # Kiểm tra trên đường dẫn đã chuẩn hoá: "uploads/../documents/x" hay "./documents/x" vẫn là tài liệu gốc
    if top_folder(path) == "documents" and not p.is_manager:
        raise HTTPException(403, "Chỉ quản lý được tải tài liệu gốc.")
    if not path.is_file():
        raise HTTPException(404, "Không có file.")
    return FileResponse(path, filename=path.name.split("-", 1)[-1])


@router.get("/jobs/{jid}")
def get_job(jid: int, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    j = db.get(Job, jid)
    if j is None or (j.created_by != p.user.id and not p.is_admin):
        raise HTTPException(404, "Không tìm thấy việc.")
    return {"id": j.id, "kind": j.kind, "status": j.status, "result": j.result, "error": j.error}
