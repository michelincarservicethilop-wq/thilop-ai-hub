import json
from collections.abc import Iterator

from fastapi import HTTPException

from ..services.llm import GatewayError


def raise_http(e: GatewayError):
    raise HTTPException(status_code=e.status_code, detail=e.message)


def sse(obj: dict) -> str:
    return "data: " + json.dumps(obj, ensure_ascii=False, default=str) + "\n\n"


def primed(gen: Iterator):
    """Chạy tới phần tử đầu tiên để lỗi (hết hạn mức, sai model...) trả về đúng mã HTTP trước khi stream."""
    try:
        first = next(gen)
    except GatewayError as e:
        raise_http(e)
    except StopIteration:
        return iter(())

    def chain():
        yield first
        yield from gen

    return chain()
