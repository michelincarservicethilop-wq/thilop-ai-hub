"""Lưu file (tài liệu, ghi âm, giọng đọc, Excel xuất ra) trên ổ đĩa server, thư mục DATA_DIR/files."""
import os
import re
import uuid
from pathlib import Path

from ..config import get_settings


def files_dir() -> Path:
    p = Path(get_settings().data_dir) / "files"
    p.mkdir(parents=True, exist_ok=True)
    return p


def safe_name(name: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "-", os.path.basename(name or "file")).strip("-.") or "file"
    return base[-80:]


def save_bytes(data: bytes, original_name: str, folder: str = "uploads") -> str:
    """Trả về đường dẫn tương đối (dùng cho /api/files/<path>)."""
    d = files_dir() / folder
    d.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex[:12]}-{safe_name(original_name)}"
    (d / name).write_bytes(data)
    return f"{folder}/{name}"


def abs_path(rel: str) -> Path:
    root = files_dir().resolve()
    p = (root / rel).resolve()
    # is_relative_to (không dùng startswith: "/data/files-khac" cũng bắt đầu bằng "/data/files")
    if p == root or not p.is_relative_to(root):
        raise ValueError("Đường dẫn không hợp lệ")
    return p


def top_folder(p: Path) -> str:
    """Thư mục cấp 1 (uploads, documents, tts...) của một đường dẫn đã qua abs_path."""
    return p.relative_to(files_dir().resolve()).parts[0]
