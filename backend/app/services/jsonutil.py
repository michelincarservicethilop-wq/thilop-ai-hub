"""Đọc JSON do model AI trả về: bỏ khung ```json```, lấy khối {...} đầu tiên, chịu được chữ thừa xung quanh."""
import json
import re
from decimal import Decimal, InvalidOperation
from typing import Any

_FENCE = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.S)


def parse_json_object(text: str | None) -> dict | None:
    """Trả về dict, hoặc None nếu không tìm thấy JSON hợp lệ."""
    if not text:
        return None
    candidates: list[str] = []
    m = _FENCE.search(text)
    if m:
        candidates.append(m.group(1))
    candidates.append(text)
    for c in candidates:
        c = c.strip()
        try:
            v = json.loads(c)
            if isinstance(v, dict):
                return v
        except ValueError:
            pass
        start = c.find("{")
        if start < 0:
            continue
        # Tìm khối {...} cân bằng ngoặc đầu tiên (bỏ qua ngoặc nằm trong chuỗi)
        depth, in_str, esc = 0, False, False
        for i in range(start, len(c)):
            ch = c[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        v = json.loads(c[start:i + 1])
                        if isinstance(v, dict):
                            return v
                    except ValueError:
                        pass
                    break
    return None


def to_number(v: Any) -> float | None:
    """Chuyển '1.200.000đ', '1,200,000', '12,5' ... thành số. Không đọc được thì None."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float, Decimal)):
        return float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v))
    if not s or not re.search(r"\d", s):
        return None
    if "," in s and "." in s:
        # dấu xuất hiện sau cùng là dấu thập phân
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        parts = s.split(",")
        s = s.replace(",", "") if all(len(p) == 3 for p in parts[1:]) else s.replace(",", ".")
    elif "." in s:
        parts = s.split(".")
        if len(parts) > 2 or (len(parts) == 2 and len(parts[1]) == 3):
            s = s.replace(".", "")  # 1.200.000 kiểu Việt Nam
    try:
        return float(Decimal(s))
    except (InvalidOperation, ValueError):
        return None
