"""Tạo bảng và dữ liệu mẫu lần đầu chạy."""
import logging
from decimal import Decimal
from pathlib import Path

import yaml
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import Base, engine, session_factory
from ..models import AIModel, Branch, PromptTemplate, RouteRule, User
from ..security import hash_password

log = logging.getLogger("hub.seed")


def create_schema() -> None:
    with engine().begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine())
    with engine().begin() as conn:
        # Chỉ mục tìm kiếm theo nghĩa cho Hỏi tài liệu (nhanh khi tài liệu nhiều)
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_doc_chunks_embedding ON doc_chunks USING hnsw (embedding vector_cosine_ops)"))


def seed(db: Session) -> None:
    data = yaml.safe_load((Path(__file__).parent / "seed.yaml").read_text(encoding="utf-8"))
    s = get_settings()
    if db.execute(select(AIModel.id).limit(1)).first() is None:
        for m in data["models"]:
            row = AIModel(**{k: v for k, v in m.items() if not k.startswith("price")})
            for k in ("price_in_vnd", "price_out_vnd", "price_cache_vnd", "price_per_minute_vnd"):
                if k in m:
                    setattr(row, k, Decimal(str(m[k])))
            db.add(row)
        for r in data["routes"]:
            db.add(RouteRule(**r))
        log.info("Đã tạo danh sách model và router mặc định")
    if db.execute(select(Branch.id).limit(1)).first() is None:
        for b in data["branches"]:
            db.add(Branch(**b))
    if db.execute(select(PromptTemplate.id).limit(1)).first() is None:
        for pr in data["prompts"]:
            db.add(PromptTemplate(**pr))
    if db.execute(select(User.id).where(User.role == "admin").limit(1)).first() is None:
        db.add(User(email=s.admin_email.lower(), name=s.admin_name, password_hash=hash_password(s.admin_password), role="admin"))
        log.info("Đã tạo tài khoản admin %s", s.admin_email)
    db.commit()


def init_db() -> None:
    create_schema()
    with session_factory()() as db:
        seed(db)
