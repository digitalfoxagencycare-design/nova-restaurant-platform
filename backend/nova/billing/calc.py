"""Bill arithmetic in integer paise. No floats ever reach a total.

Prices are per-unit paise. Tax is the tenant's default rate unless the line carries its own. In ``inclusive``
mode prices already contain tax (tax is carved out); in ``exclusive`` mode tax is added on top. A bill discount is
shared across lines in proportion to their value (largest remainder), so the parts always add up to the whole.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any


def _round(x: Decimal) -> int:
    return int(x.quantize(Decimal(1), rounding=ROUND_HALF_UP))


@dataclass(frozen=True)
class Totals:
    subtotal: int
    discount: int
    tax: int
    total: int
    lines: list[dict[str, int]]

    def as_dict(self) -> dict[str, Any]:
        return {"subtotal": self.subtotal, "discount": self.discount, "tax": self.tax, "total": self.total, "lines": self.lines}


def line_value(line: dict[str, Any]) -> int:
    return int(line["price"]) * int(line["qty"])


def discount_amount(subtotal: int, discount: dict[str, Any] | None) -> int:
    if not discount or not discount.get("value"):
        return 0
    if discount["kind"] == "pct":
        return min(subtotal, _round(Decimal(subtotal) * Decimal(str(discount["value"])) / 100))
    return min(subtotal, int(discount["value"]))


def allocate(total: int, weights: list[int]) -> list[int]:
    """Split ``total`` over ``weights`` so the parts sum exactly to ``total`` (largest remainder)."""
    s = sum(weights)
    if total <= 0 or s <= 0:
        return [0] * len(weights)
    raw = [Decimal(total) * w / s for w in weights]
    parts = [int(r) for r in raw]
    left = total - sum(parts)
    order = sorted(range(len(weights)), key=lambda i: raw[i] - parts[i], reverse=True)
    for i in order[:left]:
        parts[i] += 1
    return parts


def compute(lines: list[dict[str, Any]], discount: dict[str, Any] | None, default_rate: float, mode: str) -> Totals:
    live = [ln for ln in lines if int(ln["qty"]) > 0]
    values = [line_value(ln) for ln in live]
    subtotal = sum(values)
    disc = discount_amount(subtotal, discount)
    shares = allocate(disc, values)
    tax_total = 0
    out: list[dict[str, int]] = []
    for ln, v, sh in zip(live, values, shares, strict=True):
        net = v - sh
        rate = Decimal(str(ln.get("tax_rate", default_rate)))
        tax = _round(Decimal(net) - Decimal(net) / (1 + rate)) if mode == "inclusive" else _round(Decimal(net) * rate)
        tax_total += tax
        out.append({"value": v, "discount": sh, "tax": tax})
    total = subtotal - disc + (tax_total if mode == "exclusive" else 0)
    return Totals(subtotal, disc, tax_total, total, out)


def paid_amount(bill: dict[str, Any]) -> int:
    """Money kept: payments minus change handed back minus refunds."""
    got = sum(p["amount"] for p in bill.get("payments", []))
    back = sum(r["amount"] for r in bill.get("refunds", []))
    return got - back


def balance(bill: dict[str, Any]) -> int:
    return bill["totals"]["total"] - paid_amount(bill)
