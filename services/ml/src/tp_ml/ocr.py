"""v1.7 Wave 10 — Invoice OCR.

Accepts base64-encoded invoice images/PDFs, runs RapidOCR (ONNX-only, CPU-friendly),
and returns best-effort line items. The heavy dependency (`rapidocr-onnxruntime`)
is optional — when absent the endpoint returns an explanatory `unavailable`
status instead of raising so dev environments without the extra still boot.
"""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass

from fastapi import APIRouter
from pydantic import BaseModel, Field

try:
    from rapidocr_onnxruntime import RapidOCR  # type: ignore[import-not-found]

    _OCR: RapidOCR | None = RapidOCR()
    _OCR_AVAILABLE = True
except ImportError:
    _OCR = None
    _OCR_AVAILABLE = False


router = APIRouter(prefix="/v1/ocr", tags=["ocr"])


class OcrRequest(BaseModel):
    restaurant_id: str
    delivery_id: str
    image_base64: str = Field(..., description="Raw image bytes, base64-encoded (PNG/JPEG/PDF)")


class ExtractedLine(BaseModel):
    raw_text: str
    description: str | None = None
    qty: float | None = None
    unit_cost_cents: int | None = None


class OcrResponse(BaseModel):
    status: str  # 'parsed' | 'failed' | 'unavailable'
    lines: list[ExtractedLine]
    raw_text: str | None = None


# Match "<qty> [x] <description> @ $<price>" loosely. Real invoices vary wildly;
# owners can still correct the parsed rows manually in the reconciliation UI.
_LINE_RE = re.compile(
    r"^\s*(?P<qty>\d+(?:\.\d+)?)\s*(?:x|\*)?\s*(?P<desc>.+?)\s+\$?(?P<price>\d+(?:\.\d{1,2})?)\s*$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Parsed:
    qty: float | None
    description: str | None
    unit_cost_cents: int | None


def parse_line(text: str) -> Parsed:
    m = _LINE_RE.match(text)
    if not m:
        return Parsed(qty=None, description=None, unit_cost_cents=None)
    price = float(m.group("price"))
    return Parsed(
        qty=float(m.group("qty")),
        description=m.group("desc").strip(),
        unit_cost_cents=int(round(price * 100)),
    )


@router.post("/invoice", response_model=OcrResponse)
async def ocr_invoice(req: OcrRequest) -> OcrResponse:
    if not _OCR_AVAILABLE or _OCR is None:
        return OcrResponse(
            status="unavailable",
            lines=[],
            raw_text="rapidocr-onnxruntime is not installed on this ML service",
        )
    try:
        image_bytes = base64.b64decode(req.image_base64)
    except (ValueError, TypeError):
        return OcrResponse(status="failed", lines=[], raw_text="invalid base64 payload")
    try:
        result, _elapsed = _OCR(image_bytes)
    except Exception as err:  # noqa: BLE001 — OCR surface varies by version
        return OcrResponse(status="failed", lines=[], raw_text=f"ocr error: {err!r}")
    if not result:
        return OcrResponse(status="parsed", lines=[], raw_text="")
    texts = [row[1] for row in result]
    raw_text = "\n".join(texts)
    lines: list[ExtractedLine] = []
    for text in texts:
        parsed = parse_line(text)
        lines.append(
            ExtractedLine(
                raw_text=text,
                description=parsed.description,
                qty=parsed.qty,
                unit_cost_cents=parsed.unit_cost_cents,
            )
        )
    return OcrResponse(status="parsed", lines=lines, raw_text=raw_text)
