"""Hộp thư khách hàng (Messenger, Zalo OA): danh sách, xem, nhận/trả lại cho bot, trả lời, cài đặt bot, thử bot."""
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import false, func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import admin, manager, web_user
from ..models import Branch, CustomerConversation, CustomerMessage, User
from ..services import inbox_bot
from ..services.principal import Principal
from ..services.settings_store import DEFAULTS, get_setting, set_setting
from ..services.timeutil import VN

router = APIRouter(prefix="/api/inbox", tags=["inbox"])

CHANNELS = ("messenger", "zalo")
STATUSES = ("bot", "human", "done")


# ---------------- Phân quyền xem ----------------
def _visible(q, p: Principal):
    """Admin thấy hết; quản lý thấy cơ sở mình + hội thoại chưa gán cơ sở; nhân viên chỉ thấy cơ sở mình."""
    if p.is_admin:
        return q
    if p.user.role == "manager":
        cond = CustomerConversation.branch_id.is_(None)
        if p.branch_id:
            cond = or_(cond, CustomerConversation.branch_id == p.branch_id)
        return q.where(cond)
    return q.where(CustomerConversation.branch_id == p.branch_id) if p.branch_id else q.where(false())


def _can_see(conv: CustomerConversation, p: Principal) -> bool:
    if p.is_admin:
        return True
    if p.user.role == "manager":
        return conv.branch_id is None or conv.branch_id == p.branch_id
    return p.branch_id is not None and conv.branch_id == p.branch_id


def _get(db: Session, p: Principal, cid: int) -> CustomerConversation:
    c = db.get(CustomerConversation, cid)
    if c is None or not _can_see(c, p):
        raise HTTPException(404, "Không tìm thấy hội thoại.")
    return c


def _time(ts: datetime | None) -> str | None:
    return ts.astimezone(VN).isoformat() if ts else None


def _detail(db: Session, c: CustomerConversation) -> dict[str, Any]:
    rows = db.execute(
        select(CustomerMessage, User.name).join(User, User.id == CustomerMessage.staff_user_id, isouter=True)
        .where(CustomerMessage.conversation_id == c.id).order_by(CustomerMessage.id)
    ).all()
    w = inbox_bot.window_info(c)
    return {
        "id": c.id, "channel": c.channel, "name": c.name, "branch_id": c.branch_id,
        "branch_name": c.branch.name if c.branch else None, "status": c.status, "handoff_reason": c.handoff_reason,
        "last_message_at": _time(c.last_message_at),
        "window": {"bot_can_reply": w["bot_can_reply"], "staff_can_reply": w["staff_can_reply"], "note": w["note"]},
        "messages": [inbox_bot.message_out(m, staff) for m, staff in rows],
    }


# ---------------- Danh sách & chi tiết ----------------
@router.get("/conversations")
def list_conversations(status: str = "", branch_id: str = "", q: str = "",
                       p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    query = _visible(select(CustomerConversation), p)
    if status:
        if status not in STATUSES:
            raise HTTPException(400, "Trạng thái phải là bot, human hoặc done.")
        query = query.where(CustomerConversation.status == status)
    if branch_id:
        if branch_id in ("none", "null"):
            query = query.where(CustomerConversation.branch_id.is_(None))
        elif branch_id.isdigit():
            query = query.where(CustomerConversation.branch_id == int(branch_id))
        else:
            raise HTTPException(400, "Mã cơ sở không hợp lệ.")
    if q.strip():
        like = f"%{q.strip()}%"
        has_text = select(CustomerMessage.id).where(CustomerMessage.conversation_id == CustomerConversation.id,
                                                    CustomerMessage.text.ilike(like)).exists()
        query = query.where(or_(CustomerConversation.name.ilike(like), has_text))
    convs = db.execute(query.order_by(CustomerConversation.last_message_at.desc()).limit(200)).scalars().all()
    if not convs:
        return []
    last_ids = select(func.max(CustomerMessage.id)).where(
        CustomerMessage.conversation_id.in_([c.id for c in convs])).group_by(CustomerMessage.conversation_id)
    last = {m.conversation_id: m for m in db.execute(select(CustomerMessage).where(CustomerMessage.id.in_(last_ids))).scalars()}
    out = []
    for c in convs:
        m = last.get(c.id)
        out.append({
            "id": c.id, "channel": c.channel, "name": c.name, "branch_id": c.branch_id,
            "branch_name": c.branch.name if c.branch else None, "status": c.status, "handoff_reason": c.handoff_reason,
            "last_message": (m.text[:120] if m else ""), "last_message_at": _time(c.last_message_at),
            # đang chờ nhân viên: hội thoại ở chế độ người và tin cuối là của khách (hoặc thông báo chuyển người)
            "unread_human": bool(c.status == "human" and m is not None and m.sender in ("customer", "system")),
        })
    return out


@router.get("/conversations/{cid}")
def get_conversation(cid: int, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    return _detail(db, _get(db, p, cid))


# ---------------- Thao tác ----------------
def _system(db: Session, c: CustomerConversation, text: str) -> None:
    db.add(CustomerMessage(conversation_id=c.id, sender="system", text=text))


@router.post("/conversations/{cid}/takeover")
def takeover(cid: int, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    c = _get(db, p, cid)
    c.status, c.assigned_user_id = "human", p.user.id
    _system(db, c, f"{p.user.name} đã nhận cuộc trò chuyện, bot tạm dừng")
    db.commit()
    return _detail(db, c)


@router.post("/conversations/{cid}/release")
def release(cid: int, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    c = _get(db, p, cid)
    c.status, c.handoff_reason, c.assigned_user_id = "bot", "", None
    _system(db, c, f"{p.user.name} đã trả lại cho bot")
    db.commit()
    return _detail(db, c)


@router.post("/conversations/{cid}/done")
def done(cid: int, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    c = _get(db, p, cid)
    c.status = "done"
    _system(db, c, f"{p.user.name} đánh dấu đã xong")
    db.commit()
    return _detail(db, c)


class BranchIn(BaseModel):
    branch_id: int | None = None


@router.post("/conversations/{cid}/branch")
def change_branch(cid: int, body: BranchIn, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    c = _get(db, p, cid)
    b = None
    if body.branch_id is not None:
        b = db.get(Branch, body.branch_id)
        if b is None:
            raise HTTPException(400, "Không tìm thấy cơ sở.")
    c.branch_id = b.id if b else None
    _system(db, c, f"{p.user.name} chuyển sang cơ sở {b.name}" if b else f"{p.user.name} bỏ gán cơ sở")
    db.commit()
    db.refresh(c)
    return _detail(db, c)


class ReplyIn(BaseModel):
    text: str


@router.post("/conversations/{cid}/reply")
def reply(cid: int, body: ReplyIn, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    c = _get(db, p, cid)
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Tin nhắn trống.")
    if len(text) > 2000:
        raise HTTPException(400, "Tin nhắn quá dài (tối đa 2.000 ký tự).")
    w = inbox_bot.window_info(c)
    if not w["staff_can_reply"]:
        raise HTTPException(400, f"Không gửi được: {w['note']}")
    sent = inbox_bot.send_to_channel(db, c, text, human_agent=w["human_agent"])
    m = CustomerMessage(conversation_id=c.id, sender="staff", text=text, staff_user_id=p.user.id,
                        meta={"sent": sent, "human_agent": w["human_agent"]})
    db.add(m)
    c.last_message_at = datetime.now(UTC)
    if c.status == "bot":
        c.status = "human"  # nhân viên đã vào cuộc → bot dừng
    if c.assigned_user_id is None:
        c.assigned_user_id = p.user.id
    db.commit()
    db.refresh(m)
    return inbox_bot.message_out(m, p.user.name)


# ---------------- Cài đặt bot ----------------
@router.get("/settings")
def get_settings_(p: Principal = Depends(manager), db: Session = Depends(get_db)):
    return get_setting(db, "inbox")


@router.put("/settings")
def put_settings(body: dict[str, Any], p: Principal = Depends(admin), db: Session = Depends(get_db)):
    allowed = DEFAULTS["inbox"].keys()
    unknown = [k for k in body if k not in allowed]
    if unknown:
        raise HTTPException(400, f"Không có mục cài đặt: {', '.join(unknown)}")
    cur = dict(get_setting(db, "inbox"))
    for k, v in body.items():
        if isinstance(DEFAULTS["inbox"][k], dict) and isinstance(v, dict):
            v = {**cur.get(k, {}), **v}
        cur[k] = v
    bid = cur.get("default_branch_id")
    if bid is not None and db.get(Branch, bid) is None:
        raise HTTPException(400, "Cơ sở mặc định không tồn tại.")
    set_setting(db, "inbox", cur)
    return get_setting(db, "inbox")


# ---------------- Thử bot ----------------
class SimulateIn(BaseModel):
    channel: str = "messenger"
    external_user_id: str = "khach-thu"
    name: str = "Khách thử"
    text: str


@router.post("/simulate")
def simulate(body: SimulateIn, p: Principal = Depends(admin), db: Session = Depends(get_db)):
    if body.channel not in CHANNELS:
        raise HTTPException(400, "Kênh phải là messenger hoặc zalo.")
    if not body.text.strip():
        raise HTTPException(400, "Tin nhắn trống.")
    # Tiền tố "thu-" để hội thoại thử không ghi đè vào hội thoại của khách thật
    ext_id = body.external_user_id if body.external_user_id.startswith("thu-") else "thu-" + body.external_user_id
    replies = inbox_bot.handle_incoming(db, body.channel, ext_id, body.name, body.text.strip(),
                                        external_id=f"sim-{uuid.uuid4().hex[:12]}", send=False)
    conv = db.execute(select(CustomerConversation).where(
        CustomerConversation.channel == body.channel,
        CustomerConversation.external_user_id == ext_id)).scalar_one()
    return {"conversation_id": conv.id, "replies": replies}
