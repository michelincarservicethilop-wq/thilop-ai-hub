"""Studio: kịch bản video ngắn cho nhân viên tự quay tại cơ sở, và giọng đọc (TTS).

Hub KHÔNG tạo ảnh hay video bằng AI — chỉ viết kịch bản để nhân viên quay thật.
"""
import hashlib
import logging
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import web_user
from ..models import AudioClip, Branch
from ..services import llm, storage, tts
from ..services.jsonutil import parse_json_object
from ..services.principal import Principal
from ..services.quota import QuotaExceeded, ensure_quota
from ..services.settings_store import get_setting
from ..services.usage import log_usage
from .apps import branch_info
from .common import raise_http

router = APIRouter(prefix="/api/studio", tags=["studio"])
log = logging.getLogger("hub.studio")

PLATFORM_VN = {"tiktok": "TikTok (video dọc 9:16)", "fanpage": "Fanpage Facebook (Reels/video)", "zalo": "Zalo OA / Zalo Video"}
MAX_TTS_CHARS = 5000

SCRIPT_SYSTEM = (
    "Bạn là biên kịch video ngắn cho Thi Lốp — chuỗi dịch vụ lốp, ắc quy, chăm sóc và sửa chữa ô tô. "
    "Viết kịch bản để NHÂN VIÊN TỰ QUAY bằng điện thoại tại cơ sở (xe thật, xưởng thật, người thật); "
    "không đề xuất ảnh/video tạo bằng AI. Mỗi cảnh ghi rõ mốc thời gian, cảnh quay (góc máy, hành động), "
    "lời thoại/lồng tiếng và chữ trên màn hình. 3 giây đầu phải gây chú ý. Không bịa giá, khuyến mãi hay cam kết; "
    "chỗ cần giá ghi [GIÁ]. Kết bằng lời kêu gọi đặt lịch/nhắn tin. Tiếng Việt tự nhiên, đời thường.\n"
    "Trả về DUY NHẤT một JSON:\n"
    '{"script": "kịch bản nhiều dòng, mỗi cảnh một đoạn dạng: [0–3s] Cảnh: ... | Lời: ... | Chữ: ...", '
    '"caption": "chú thích đăng kèm (dưới 300 ký tự)", "hashtags": ["#thilop", "..."]}\n'
    "hashtags gồm 5–8 thẻ, có dấu #, không khoảng trắng."
)


class ScriptIn(BaseModel):
    service: str
    platform: str = "tiktok"
    length_sec: int | None = None
    branch_id: int | None = None
    notes: str | None = None


def _hashtags(v) -> list[str]:
    if isinstance(v, str):
        v = v.replace(",", " ").split()
    out: list[str] = []
    for h in v or []:
        h = "".join(str(h).split())
        if not h:
            continue
        h = h if h.startswith("#") else "#" + h
        if h.lower() not in (x.lower() for x in out):
            out.append(h)
    return out[:8]


def _script_text(v) -> str:
    """Model có thể trả 'script' dạng danh sách cảnh → ghép thành chữ."""
    if isinstance(v, list):
        lines = []
        for sc in v:
            if isinstance(sc, dict):
                lines.append(" | ".join(f"{k}: {x}" for k, x in sc.items() if x))
            else:
                lines.append(str(sc))
        return "\n".join(lines)
    return str(v or "").strip()


@router.post("/script")
def script(body: ScriptIn, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    if not body.service.strip():
        raise HTTPException(400, "Chưa nhập dịch vụ cần làm video.")
    if body.platform not in PLATFORM_VN:
        raise HTTPException(400, "Nền tảng phải là tiktok, fanpage hoặc zalo.")
    length = max(10, min(int(body.length_sec or 30), 180))
    b = db.get(Branch, body.branch_id) if body.branch_id else None
    if body.branch_id and b is None:
        raise HTTPException(400, "Không tìm thấy cơ sở.")
    user = f"Dịch vụ: {body.service.strip()}\nNền tảng: {PLATFORM_VN[body.platform]}\nĐộ dài: khoảng {length} giây"
    if b:
        user += "\n" + branch_info(b)
    if body.notes:
        user += f"\nGhi chú: {body.notes.strip()}"
    try:
        r = llm.chat(db, p, app="studio", feature="script", task_hint="writing", branch_id=b.id if b else None,
                     messages=[{"role": "system", "content": SCRIPT_SYSTEM}, {"role": "user", "content": user}])
    except llm.GatewayError as e:
        raise_http(e)
    data = parse_json_object(r.content)
    if data is None or not data.get("script"):
        return {"script": r.content.strip(), "caption": "", "hashtags": [], "cost_vnd": float(r.cost_vnd)}
    return {"script": _script_text(data.get("script")), "caption": str(data.get("caption") or "").strip(),
            "hashtags": _hashtags(data.get("hashtags")), "cost_vnd": float(r.cost_vnd)}


# ---------------- Giọng đọc ----------------
@router.get("/voices")
def voices(p: Principal = Depends(web_user)):
    return tts.list_voices()


class TTSIn(BaseModel):
    text: str
    voice: str | None = None


@router.post("/tts")
def text_to_speech(body: TTSIn, p: Principal = Depends(web_user), db: Session = Depends(get_db)):
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Chưa nhập nội dung cần đọc.")
    if len(text) > MAX_TTS_CHARS:
        raise HTTPException(400, f"Nội dung quá dài ({len(text):,} ký tự, tối đa {MAX_TTS_CHARS:,}).")
    cfg = get_setting(db, "tts") or {}
    voice = body.voice or cfg.get("default_voice") or "fpt:banmai"
    if tts.find_voice(voice) is None:
        raise HTTPException(400, "Không có giọng đọc này.")
    try:
        llm.check_rate(p, int(get_setting(db, "web_rpm_limit") or 30))
        ensure_quota(db, p)
    except llm.GatewayError as e:
        raise_http(e)
    except QuotaExceeded as e:
        raise HTTPException(402, e.message) from e

    chars = len(text)
    h = hashlib.sha256((voice + "\n" + text).encode("utf-8")).hexdigest()
    clip = db.execute(select(AudioClip).where(AudioClip.hash == h)).scalar_one_or_none()
    if clip is not None and storage.abs_path(clip.path).is_file():
        log_usage(db, p, app="studio", feature="tts", model_used=voice, units=chars, cache_hit=True,
                  excerpt=text[:500])
        return {"url": f"/api/files/{clip.path}", "chars": chars, "cached": True, "cost_vnd": 0}

    try:
        audio = tts.synthesize(voice, text)
    except tts.TTSError as e:
        log_usage(db, p, app="studio", feature="tts", model_used=voice, units=chars, status="error", error=e.message)
        raise HTTPException(e.status_code, e.message) from e
    rel = storage.save_bytes(audio, voice.replace(":", "-") + ".mp3", folder="tts")
    price = Decimal(str(cfg.get("price_per_1000_chars_vnd") or 0))
    cost = (Decimal(chars) / 1000 * price).quantize(Decimal("0.01"))
    if clip is None:
        db.add(AudioClip(hash=h, provider=voice.split(":", 1)[0], voice=voice, chars=chars, path=rel, created_by=p.user.id))
    else:
        clip.path = rel  # file cũ bị mất → thay bằng file mới
    try:
        db.commit()
    except IntegrityError:  # hai yêu cầu giống hệt chạy cùng lúc → giữ bản đã lưu trước
        db.rollback()
    log_usage(db, p, app="studio", feature="tts", model_used=voice, units=chars, cost_vnd=cost, excerpt=text[:500])
    return {"url": f"/api/files/{rel}", "chars": chars, "cached": False, "cost_vnd": float(cost)}

