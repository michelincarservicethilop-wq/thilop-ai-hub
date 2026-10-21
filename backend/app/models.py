"""Toàn bộ bảng dữ liệu của Hub."""
from datetime import datetime
from decimal import Decimal

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .config import get_settings
from .db import Base

ROLES = ("admin", "manager", "staff", "machine")
APPS = ("api", "chat", "inbox", "apps", "studio")


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON)


class Branch(Base):
    __tablename__ = "branches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    address: Mapped[str] = mapped_column(String(300), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    hours: Mapped[str] = mapped_column(String(200), default="")  # ví dụ "7:30–18:00, cả tuần"
    keywords: Mapped[str] = mapped_column(String(300), default="")  # từ khoá nhận diện cơ sở trong tin khách, cách nhau dấu phẩy
    monthly_limit_vnd: Mapped[int | None] = mapped_column(Integer, nullable=True)
    daily_limit_vnd: Mapped[int | None] = mapped_column(Integer, nullable=True)
    telegram_chat_id: Mapped[str] = mapped_column(String(60), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(200), default="")
    role: Mapped[str] = mapped_column(String(20), default="staff")
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    monthly_limit_vnd: Mapped[int | None] = mapped_column(Integer, nullable=True)
    daily_limit_vnd: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    branch: Mapped[Branch | None] = relationship(lazy="joined")


class ApiKey(Base):
    __tablename__ = "api_keys"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    prefix: Mapped[str] = mapped_column(String(20))  # vài ký tự đầu để nhận diện, ví dụ tl-AbCd
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    daily_limit_vnd: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rpm_limit: Mapped[int] = mapped_column(Integer, default=60)
    allowed_models: Mapped[list | None] = mapped_column(JSON, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(lazy="joined")


class AIModel(Base):
    """Model mà Hub cho phép dùng. `id` là tên ngắn nội bộ (ví dụ claude-sonnet)."""

    __tablename__ = "ai_models"
    id: Mapped[str] = mapped_column(String(60), primary_key=True)
    label: Mapped[str] = mapped_column(String(120))
    provider_model: Mapped[str] = mapped_column(String(120))  # chuỗi LiteLLM, ví dụ anthropic/claude-sonnet-5-5
    kind: Mapped[str] = mapped_column(String(20), default="chat")  # chat | embedding | stt
    vision: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    admin_only: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str] = mapped_column(String(200), default="")
    # Giá bán nội bộ (VND / 1 triệu token). Để trống thì lấy bảng giá của LiteLLM × tỷ giá.
    price_in_vnd: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    price_out_vnd: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    price_cache_vnd: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    price_per_minute_vnd: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)  # cho model chuyển giọng nói
    fallback_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    sort: Mapped[int] = mapped_column(Integer, default=100)


class RouteRule(Base):
    """Khi model = auto: loại việc → model chính + model dự phòng."""

    __tablename__ = "route_rules"
    task: Mapped[str] = mapped_column(String(30), primary_key=True)  # easy | vision | writing | hard
    label: Mapped[str] = mapped_column(String(120))
    primary_model: Mapped[str] = mapped_column(String(60))
    fallback_model: Mapped[str | None] = mapped_column(String(60), nullable=True)
    sort: Mapped[int] = mapped_column(Integer, default=100)


class UsageLog(Base):
    __tablename__ = "usage_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    api_key_id: Mapped[int | None] = mapped_column(ForeignKey("api_keys.id"), nullable=True, index=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True, index=True)
    app: Mapped[str] = mapped_column(String(20), default="api")
    feature: Mapped[str] = mapped_column(String(40), default="")  # ví dụ ask, invoice, tts, bot
    model_requested: Mapped[str] = mapped_column(String(60), default="")
    model_used: Mapped[str] = mapped_column(String(60), default="")
    task: Mapped[str] = mapped_column(String(30), default="")
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cached_tokens: Mapped[int] = mapped_column(Integer, default=0)
    units: Mapped[int] = mapped_column(Integer, default=0)  # ký tự (TTS) hoặc giây (ghi âm)
    cost_vnd: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    cache_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="ok")  # ok | error | blocked
    error: Mapped[str] = mapped_column(Text, default="")
    excerpt: Mapped[str] = mapped_column(Text, default="")  # trích nội dung khi bật lưu hội thoại

    __table_args__ = (Index("ix_usage_branch_time", "branch_id", "created_at"),)


class AlertSent(Base):
    __tablename__ = "alerts_sent"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scope: Mapped[str] = mapped_column(String(20))  # company | branch | user | key
    scope_id: Mapped[int] = mapped_column(Integer, default=0)
    period: Mapped[str] = mapped_column(String(20))  # 2026-10 hoặc 2026-10-22
    level: Mapped[int] = mapped_column(Integer)  # 80 | 100
    message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ---------- Chat AI ----------
class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="Hội thoại mới")
    model: Mapped[str] = mapped_column(String(60), default="auto")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    model_used: Mapped[str] = mapped_column(String(60), default="")
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_vnd: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PromptTemplate(Base):
    __tablename__ = "prompt_templates"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scope: Mapped[str] = mapped_column(String(20), default="chat")
    title: Mapped[str] = mapped_column(String(200))
    text: Mapped[str] = mapped_column(Text)
    sort: Mapped[int] = mapped_column(Integer, default=100)


# ---------- Tài liệu (Hỏi tài liệu, nguồn trả lời của bot) ----------
class Document(Base):
    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    filename: Mapped[str] = mapped_column(String(300))
    path: Mapped[str] = mapped_column(String(400))
    public_kb: Mapped[bool] = mapped_column(Boolean, default=True)  # bot trả lời khách được dùng tài liệu này
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | indexing | ready | error
    error: Mapped[str] = mapped_column(Text, default="")
    pages: Mapped[int] = mapped_column(Integer, default=0)
    chunks: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DocChunk(Base):
    __tablename__ = "doc_chunks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    page: Mapped[int] = mapped_column(Integer, default=1)
    text: Mapped[str] = mapped_column(Text)
    embedding = mapped_column(Vector(get_settings().embed_dim))


# ---------- Việc chạy nền ----------
class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(40))  # index_document | meeting | ...
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)  # queued | running | done | error
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AudioClip(Base):
    __tablename__ = "audio_clips"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    provider: Mapped[str] = mapped_column(String(30))
    voice: Mapped[str] = mapped_column(String(60))
    chars: Mapped[int] = mapped_column(Integer, default=0)
    path: Mapped[str] = mapped_column(String(400))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ---------- Hộp thư khách hàng ----------
class CustomerConversation(Base):
    __tablename__ = "customer_conversations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    channel: Mapped[str] = mapped_column(String(20))  # messenger | zalo
    external_user_id: Mapped[str] = mapped_column(String(80), index=True)
    name: Mapped[str] = mapped_column(String(120), default="Khách")
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="bot")  # bot | human | done
    handoff_reason: Mapped[str] = mapped_column(String(60), default="")
    assigned_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    greeted: Mapped[bool] = mapped_column(Boolean, default=False)
    last_customer_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_message_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    branch: Mapped[Branch | None] = relationship(lazy="joined")
    __table_args__ = (Index("ix_cust_conv_channel_user", "channel", "external_user_id", unique=True),)


class CustomerMessage(Base):
    __tablename__ = "customer_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("customer_conversations.id", ondelete="CASCADE"), index=True)
    sender: Mapped[str] = mapped_column(String(20))  # customer | bot | staff | system
    text: Mapped[str] = mapped_column(Text, default="")
    staff_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    external_id: Mapped[str] = mapped_column(String(120), default="", index=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
