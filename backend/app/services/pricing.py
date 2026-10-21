"""Quy token ra tiền Việt."""
from decimal import Decimal

import litellm
from sqlalchemy.orm import Session

from ..models import AIModel
from .settings_store import get_setting

M = Decimal(1_000_000)


def token_cost_vnd(db: Session, model: AIModel, input_tokens: int, output_tokens: int, cached_tokens: int = 0) -> Decimal:
    """Ưu tiên giá anh đặt trong trang quản trị; không có thì lấy bảng giá LiteLLM × tỷ giá."""
    uncached = max(input_tokens - cached_tokens, 0)
    if model.price_in_vnd is not None and model.price_out_vnd is not None:
        cache_price = model.price_cache_vnd if model.price_cache_vnd is not None else model.price_in_vnd
        cost = (Decimal(uncached) * model.price_in_vnd + Decimal(cached_tokens) * cache_price + Decimal(output_tokens) * model.price_out_vnd) / M
        return cost.quantize(Decimal("0.01"))
    rate = Decimal(str(get_setting(db, "usd_vnd_rate") or 26000))
    try:
        prompt_usd, completion_usd = litellm.cost_per_token(
            model=model.provider_model, prompt_tokens=input_tokens, completion_tokens=output_tokens
        )
        return (Decimal(str(prompt_usd + completion_usd)) * rate).quantize(Decimal("0.01"))
    except Exception:  # noqa: BLE001 — model mới chưa có trong bảng giá LiteLLM
        return Decimal("0.00")


def minute_cost_vnd(model: AIModel, seconds: float) -> Decimal:
    if model.price_per_minute_vnd is None:
        return Decimal("0.00")
    return (model.price_per_minute_vnd * Decimal(str(seconds)) / Decimal(60)).quantize(Decimal("0.01"))
