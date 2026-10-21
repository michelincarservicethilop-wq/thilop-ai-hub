"""Router: khi model = auto thì đoán loại việc và chọn model rẻ nhất đủ tốt."""
import unicodedata
from typing import Any

from sqlalchemy.orm import Session

from ..models import AIModel, RouteRule

TASKS = ("easy", "vision", "writing", "hard")

HARD_WORDS = (
    "hop dong", "phan tich", "lap trinh", "code", "sql", "python", "javascript", "chien luoc",
    "ke hoach kinh doanh", "bao cao tai chinh", "giai thich chi tiet", "so sanh chi tiet", "debug",
)
WRITING_WORDS = (
    "viet bai", "bai dang", "kich ban", "caption", "quang cao", "content", "email", "thu moi",
    "slogan", "tieu de", "noi dung fanpage", "tiktok",
)


def _plain(text: str) -> str:
    """Bỏ dấu tiếng Việt để so từ khoá."""
    text = unicodedata.normalize("NFD", text.lower()).replace("đ", "d")
    return "".join(c for c in text if unicodedata.category(c) != "Mn")


def _text_and_images(messages: list[dict[str, Any]]) -> tuple[str, int, bool]:
    last_user = ""
    total = 0
    has_image = False
    for m in messages:
        c = m.get("content")
        if isinstance(c, str):
            total += len(c)
            if m.get("role") == "user":
                last_user = c
        elif isinstance(c, list):
            parts = []
            for part in c:
                if isinstance(part, dict):
                    if part.get("type") in ("image_url", "image", "input_image"):
                        has_image = m.get("role") == "user" or has_image
                    elif part.get("type") == "text":
                        parts.append(str(part.get("text", "")))
            joined = " ".join(parts)
            total += len(joined)
            if m.get("role") == "user":
                last_user = joined
    return last_user, total, has_image


def classify(messages: list[dict[str, Any]]) -> str:
    last_user, total, has_image = _text_and_images(messages)
    if has_image:
        return "vision"
    t = _plain(last_user)
    if total > 12000 or any(w in t for w in HARD_WORDS):
        return "hard"
    if any(w in t for w in WRITING_WORDS):
        return "writing"
    return "easy"


def candidates(db: Session, requested: str, messages: list[dict[str, Any]], task_hint: str | None = None) -> tuple[str, list[AIModel]]:
    """Trả về (loại việc, danh sách model theo thứ tự thử)."""
    order: list[str] = []
    task = ""
    if requested in ("auto", "", None):
        task = task_hint if task_hint in TASKS else classify(messages)
        rule = db.get(RouteRule, task) or db.get(RouteRule, "easy")
        if rule:
            order = [rule.primary_model] + ([rule.fallback_model] if rule.fallback_model else [])
    else:
        m = db.get(AIModel, requested)
        if m is None:
            # cho phép gọi bằng tên model của hãng (ví dụ claude-sonnet-5-5)
            m = db.query(AIModel).filter(AIModel.provider_model.endswith("/" + requested)).first()
        if m:
            order = [m.id] + ([m.fallback_id] if m.fallback_id else [])
    models: list[AIModel] = []
    for mid in order:
        m = db.get(AIModel, mid)
        if m and m.enabled and m.kind == "chat" and m not in models:
            models.append(m)
    return task, models
