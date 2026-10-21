"""Bot trả lời khách trên Messenger / Zalo OA.

Luồng: lưu tin khách → nhận diện cơ sở → (nếu bot được phép) tìm tài liệu công khai → hỏi AI lấy JSON
{needs_human, reason, answer} → gửi trả lời hoặc chuyển nhân viên (kèm báo Telegram).
"""
from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..channels import messenger, zalo
from ..config import get_settings
from ..models import Branch, CustomerConversation, CustomerMessage, User
from . import llm, rag, telegram
from .jsonutil import parse_json_object
from .principal import Principal
from .router import _plain
from .settings_store import get_setting
from .timeutil import VN, now_vn

log = logging.getLogger("hub.inbox")

BOT_EMAIL = "bot@hub.local"
CHANNEL_VN = {"messenger": "Messenger", "zalo": "Zalo OA"}
REASON_VN = {
    "complaint": "khách phàn nàn",
    "offprice": "hỏi giá/khuyến mãi ngoài tài liệu",
    "askhuman": "khách muốn gặp nhân viên",
    "unsure": "bot chưa chắc câu trả lời",
    "error": "bot gặp lỗi (AI hoặc hạn mức)",
}
# Từ khoá (đã bỏ dấu) buộc chuyển người ngay, không cần hỏi AI
COMPLAINT_WORDS = (
    "khieu nai", "phan nan", "lam an kieu gi", "lam an the nao", "te qua", "qua te", "that vong", "buc minh",
    "lua dao", "lua khach", "chat chem", "boc phot", "khong hai long", "thai do", "doi hoan tien", "hoan tien",
    "lam an chan", "lam an cau tha", "bao hanh kieu gi", "tham te",
)
ASKHUMAN_WORDS = (
    "gap nhan vien", "gap nguoi that", "nguoi that", "noi chuyen voi nguoi", "nhan vien tu van", "tu van vien",
    "gap quan ly", "gap chu", "goi lai cho", "goi dien cho", "goi cho toi", "goi cho minh", "cho xin so dien thoai",
    "nhan vien oi", "ad oi", "admin oi", "khong muon noi chuyen voi bot", "khong phai bot",
)


# ---------------- Tiện ích ----------------
def _has_word(plain: str, words: tuple[str, ...]) -> bool:
    return any(re.search(r"(?<![a-z0-9])" + re.escape(w) + r"(?![a-z0-9])", plain) for w in words)


def precheck(text: str) -> str:
    """Kiểm tra nhanh bằng từ khoá. Trả về 'complaint' | 'askhuman' | ''."""
    t = _plain(text)
    if _has_word(t, COMPLAINT_WORDS):
        return "complaint"
    if _has_word(t, ASKHUMAN_WORDS):
        return "askhuman"
    return ""


def _aware(ts: datetime | None) -> datetime | None:
    if ts is None:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=UTC)


def window_info(conv: CustomerConversation, now: datetime | None = None) -> dict[str, Any]:
    """Còn được nhắn cho khách không: bot (Messenger 24 giờ) và nhân viên (Messenger 7 ngày với HUMAN_AGENT; Zalo theo hằng số)."""
    now = now or datetime.now(UTC)
    last = _aware(conv.last_customer_at)
    if last is None:
        return {"bot_can_reply": False, "staff_can_reply": False, "human_agent": False,
                "note": "Khách chưa nhắn tin nên chưa gửi được."}
    hours = (now - last).total_seconds() / 3600
    if conv.channel == "messenger":
        bot_h, staff_h = messenger.BOT_WINDOW_HOURS, messenger.STAFF_WINDOW_HOURS
    else:
        bot_h = staff_h = zalo.ZALO_REPLY_WINDOW_HOURS
    bot_ok, staff_ok = hours < bot_h, hours < staff_h
    human_agent = conv.channel == "messenger" and not bot_ok and staff_ok
    if bot_ok:
        left = bot_h - hours
        note = f"còn {int(left)} giờ để bot trả lời" if left >= 1 else f"còn {max(1, int(left * 60))} phút để bot trả lời"
    elif staff_ok:
        left = staff_h - hours
        note = (f"Quá {bot_h} giờ: bot dừng, nhân viên còn {left / 24:.1f} ngày để trả lời"
                + (" (gửi kèm thẻ HUMAN_AGENT)" if human_agent else ""))
    else:
        note = "Đã quá hạn nhắn tin, chờ khách nhắn lại."
    return {"bot_can_reply": bot_ok, "staff_can_reply": staff_ok, "human_agent": human_agent, "note": note}


def message_out(m: CustomerMessage, staff_name: str | None = None) -> dict[str, Any]:
    return {"id": m.id, "sender": m.sender, "text": m.text, "staff_name": staff_name or "",
            "time": m.created_at.astimezone(VN).strftime("%H:%M %d/%m") if m.created_at else "",
            "sent": (m.meta or {}).get("sent")}


def bot_principal(db: Session) -> Principal:
    """Tài khoản máy 'Bot hộp thư' (không có mật khẩu, không đăng nhập web được) để tính chi phí bot."""
    u = db.execute(select(User).where(User.email == BOT_EMAIL)).scalar_one_or_none()
    if u is None:
        try:
            u = User(email=BOT_EMAIL, name="Bot hộp thư", role="machine", password_hash="")
            db.add(u)
            db.commit()
        except IntegrityError:
            db.rollback()
            u = db.execute(select(User).where(User.email == BOT_EMAIL)).scalar_one()
    return Principal(user=u)


def detect_branch(db: Session, text: str) -> int | None:
    t = _plain(text)
    for b in db.execute(select(Branch).where(Branch.active.is_(True)).order_by(Branch.id)).scalars():
        words = [w.strip() for w in (b.keywords or "").split(",") if w.strip()]
        words.append(b.name)
        if _has_word(t, tuple(_plain(w) for w in words if len(w.strip()) >= 2)):
            return b.id
    return None


def in_business_hours(bh: dict | None, now: datetime | None = None) -> bool:
    try:
        sh, sm = (int(x) for x in str((bh or {}).get("start", "07:30")).split(":"))
        eh, em = (int(x) for x in str((bh or {}).get("end", "18:00")).split(":"))
    except ValueError:
        return True
    now = (now or now_vn()).astimezone(VN)
    cur, start, end = now.hour * 60 + now.minute, sh * 60 + sm, eh * 60 + em
    return start <= cur < end if start <= end else (cur >= start or cur < end)


def send_to_channel(db: Session, conv: CustomerConversation, text: str, *, human_agent: bool = False) -> bool:
    if conv.channel == "messenger":
        return messenger.send_text(conv.external_user_id, text, human_agent=human_agent)
    if conv.channel == "zalo":
        return zalo.send_text(db, conv.external_user_id, text)
    return False


def _upsert_conversation(db: Session, channel: str, external_user_id: str, name: str | None) -> CustomerConversation:
    q = select(CustomerConversation).where(CustomerConversation.channel == channel,
                                           CustomerConversation.external_user_id == external_user_id)
    conv = db.execute(q).scalar_one_or_none()
    if conv is None:
        try:
            conv = CustomerConversation(channel=channel, external_user_id=external_user_id,
                                        name=(name or "").strip()[:120] or "Khách", status="bot")
            db.add(conv)
            db.commit()
        except IntegrityError:  # hai tin đến cùng lúc
            db.rollback()
            conv = db.execute(q).scalar_one()
    elif name and name.strip() and conv.name in ("", "Khách"):
        conv.name = name.strip()[:120]
    return conv


def _add(db: Session, conv: CustomerConversation, sender: str, text: str, **kw) -> CustomerMessage:
    m = CustomerMessage(conversation_id=conv.id, sender=sender, text=text, **kw)
    db.add(m)
    conv.last_message_at = datetime.now(UTC)
    db.flush()
    return m


# ---------------- Hỏi AI ----------------
BOT_SYSTEM = """Bạn là trợ lý tự động trả lời khách nhắn tin cho Thi Lốp — chuỗi dịch vụ lốp, ắc quy, chăm sóc và sửa chữa ô tô.
Quy tắc bắt buộc:
- CHỈ trả lời dựa trên phần "Thông tin" bên dưới. Không bịa giá, khuyến mãi, giảm giá, cam kết, thời gian hoàn thành.
- Tiếng Việt lịch sự, xưng "em", gọi khách "anh/chị"; ngắn gọn, tối đa 80 chữ; không dùng markdown.
- Không chào lại nếu đã chào trong hội thoại.
Đặt needs_human=true và reason tương ứng khi:
{rules}
Nếu needs_human=true thì answer có thể để trống.
Trả về DUY NHẤT một JSON, không thêm chữ nào khác:
{{"needs_human": true/false, "reason": "complaint|offprice|askhuman|unsure|", "answer": "câu trả lời cho khách"}}

Thông tin:
{context}"""

RULE_TEXT = {
    "complaint": "- complaint: khách phàn nàn, bực bội, khiếu nại về dịch vụ/sản phẩm/nhân viên.",
    "offprice": "- offprice: khách hỏi giá sản phẩm/dịch vụ KHÔNG có trong Thông tin, hoặc xin giảm giá/khuyến mãi/mặc cả.",
    "askhuman": "- askhuman: khách muốn nói chuyện với nhân viên/người thật, xin gọi lại.",
    "unsure": "- unsure: Thông tin không đủ để trả lời chắc chắn.",
}


def _branch_text(b: Branch | None) -> str:
    if b is None:
        return ""
    parts = [f"Cơ sở phụ trách: Thi Lốp {b.name}"]
    for label, v in (("Địa chỉ", b.address), ("Điện thoại", b.phone), ("Giờ mở cửa", b.hours)):
        if v:
            parts.append(f"{label}: {v}")
    return "\n".join(parts)


def _ask_ai(db: Session, conv: CustomerConversation, text: str, settings: dict) -> tuple[bool, str, str]:
    """Trả về (cần người, lý do, câu trả lời)."""
    rules = settings.get("rules") or {}
    enabled = [RULE_TEXT[k] for k in RULE_TEXT if rules.get(k, True)] or ["- (không có — luôn needs_human=false)"]
    bot = bot_principal(db)
    try:
        # p=bot: tạo vector cũng qua kiểm tra hạn mức công ty/tốc độ (webhook là cửa công khai)
        results = rag.search(db, text, k=4, public_only=True, p=bot, app="inbox", feature="bot_search")
    except Exception as e:  # noqa: BLE001 — tìm tài liệu lỗi thì vẫn trả lời theo thông tin cơ sở
        log.warning("Tìm tài liệu cho bot lỗi: %s", e)
        results = []
    b = db.get(Branch, conv.branch_id) if conv.branch_id else None
    ctx = "\n\n".join(x for x in (_branch_text(b), rag.format_context(results)) if x) or "(chưa có thông tin)"
    history = db.execute(select(CustomerMessage).where(
        CustomerMessage.conversation_id == conv.id, CustomerMessage.sender.in_(("customer", "bot", "staff"))
    ).order_by(CustomerMessage.id.desc()).limit(7)).scalars().all()
    messages: list[dict] = [{"role": "system", "content": BOT_SYSTEM.format(rules="\n".join(enabled), context=ctx)}]
    for m in reversed(history[1:]):  # bỏ tin hiện tại (đã đưa vào cuối)
        messages.append({"role": "user" if m.sender == "customer" else "assistant", "content": m.text})
    messages.append({"role": "user", "content": text})
    r = llm.chat(db, bot, app="inbox", feature="bot", messages=messages,
                 model=settings.get("bot_model") or "auto", task_hint="easy", use_cache=True, branch_id=conv.branch_id)
    data = parse_json_object(r.content)
    if data is None:  # model không trả JSON (ví dụ chế độ thử) → coi cả nội dung là câu trả lời
        return False, "", r.content.strip()
    reason = str(data.get("reason") or "").strip().lower()
    needs = bool(data.get("needs_human"))
    if needs and reason not in RULE_TEXT:
        reason = "unsure"
    return needs, reason, str(data.get("answer") or "").strip()


# ---------------- Xử lý tin đến ----------------
def handle_incoming(
    db: Session,
    channel: str,
    external_user_id: str,
    name: str | None,
    text: str,
    external_id: str = "",
    send: bool = True,
) -> list[dict[str, Any]]:
    """Lưu tin khách, cho bot trả lời hoặc chuyển người. Trả về các tin bot/hệ thống vừa tạo."""
    conv = _upsert_conversation(db, channel, external_user_id, name)
    if external_id and db.execute(select(CustomerMessage.id).where(
            CustomerMessage.conversation_id == conv.id, CustomerMessage.external_id == external_id)).first():
        db.commit()
        return []  # kênh gửi lại cùng tin (retry) → bỏ qua
    now = datetime.now(UTC)
    _add(db, conv, "customer", text, external_id=external_id or "")
    conv.last_customer_at = now
    if conv.branch_id is None:
        s0 = get_setting(db, "inbox") or {}
        conv.branch_id = detect_branch(db, text) or s0.get("default_branch_id") or None
    if conv.status == "done":
        conv.status, conv.handoff_reason = "bot", ""
    db.commit()

    if conv.status == "human":
        return []  # nhân viên đang xử lý
    s = get_setting(db, "inbox") or {}
    if not s.get(f"{channel}_enabled", True):
        return []
    if not s.get("night_reply", True) and not in_business_hours(s.get("business_hours")):
        return []
    if not window_info(conv, now)["bot_can_reply"]:
        return []

    rules = s.get("rules") or {}
    forced = precheck(text)
    if forced and rules.get(forced, True):
        needs, reason, answer = True, forced, ""
    else:
        try:
            needs, reason, answer = _ask_ai(db, conv, text, s)
        except llm.GatewayError as e:
            db.rollback()
            log.warning("Bot không gọi được AI: %s", e.message)
            needs, reason, answer = True, "error", ""
        if needs and reason != "error" and not rules.get(reason, True):
            needs = False  # quy tắc này đang tắt → bot tự trả lời
        if not needs and not answer:
            needs, reason = (True, "unsure") if rules.get("unsure", True) else (False, "")

    created: list[CustomerMessage] = []
    prefix = ""
    if not conv.greeted and s.get("greeting"):
        prefix = s["greeting"].strip() + "\n\n"
    reply = (prefix + (s.get("handoff_message") or "").strip()) if needs else (prefix + answer if answer else "")
    if reply.strip():
        sent = send_to_channel(db, conv, reply) if send else False
        created.append(_add(db, conv, "bot", reply.strip(), meta={"sent": sent, "simulated": not send}))
        conv.greeted = conv.greeted or bool(prefix)
    if needs:
        conv.status, conv.handoff_reason = "human", reason
        created.append(_add(db, conv, "system", f"Chuyển cho nhân viên · {REASON_VN.get(reason, reason)}"))
    db.commit()
    if needs:
        _notify_handoff(db, conv, text, reason)
    return [message_out(m) for m in created]


def _notify_handoff(db: Session, conv: CustomerConversation, text: str, reason: str) -> None:
    b = db.get(Branch, conv.branch_id) if conv.branch_id else None
    chat_id = (b.telegram_chat_id if b and b.telegram_chat_id else "") or (get_setting(db, "telegram_admin_chat_id") or "")
    if not chat_id:
        return
    base = get_settings().public_base_url.rstrip("/")
    msg = (f"🙋 Cần nhân viên trả lời khách — {REASON_VN.get(reason, reason)}\n"
           f"Khách: {conv.name} ({CHANNEL_VN.get(conv.channel, conv.channel)})\n"
           f"Cơ sở: {b.name if b else 'chưa rõ'}\n"
           f"Tin cuối: {text[:300]}\n"
           f"Mở hộp thư: {base}/inbox?c={conv.id}")
    telegram.notify(chat_id, msg)

