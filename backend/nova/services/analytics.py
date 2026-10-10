"""Drill-down analytics: one small engine that answers "how much, by what, for which slice" for a restaurant or for the whole platform.

The idea (so a chart can be clicked, layer after layer):
  1. ``breakdown``  splits a measure (sales, orders, average bill, ...) by one dimension (day, hour, channel, payment mode, dish, ...)
  2. clicking a slice adds a **filter** (``channel:online``) and the next breakdown is computed inside that slice
  3. ``records``    lists the actual bills behind any slice, and a bill opens in full

Everything is read from the bills (money in integer paise). Scale note: this reads the bills of the chosen dates into memory and caps the
number scanned (``MAX_BILLS``, reported as ``truncated``); fine for a restaurant for a year and for dozens of restaurants for months.
Platform queries add the dimension ``restaurant``.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from ..billing import calc
from ..core.errors import bad_request
from ..tenancy.db import TenantDB

MAX_BILLS = 50_000
MAX_DAYS = 366
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# dimension -> (label, kind). kind "bill": one value per bill; "line": one value per dish line; "payment": one value per payment mode used
DIMENSIONS = {
    "day": ("Day", "bill"),
    "hour": ("Hour of day", "bill"),
    "weekday": ("Day of week", "bill"),
    "month": ("Month", "bill"),
    "channel": ("Online or counter", "bill"),
    "type": ("Order type", "bill"),
    "payment_mode": ("Payment mode", "payment"),
    "status": ("Status", "bill"),
    "customer": ("Customer", "bill"),
    "coupon": ("Offer used", "bill"),
    "rider": ("Delivery partner", "bill"),
    "table": ("Table", "bill"),
    "category": ("Menu category", "line"),
    "item": ("Dish", "line"),
    "restaurant": ("Restaurant", "bill"),
}
MEASURES = {"sales": "Sales", "orders": "Orders", "avg_bill": "Average bill", "items": "Items sold", "discount": "Discounts", "tax": "GST"}
TIME_DIMS = ("day", "hour", "weekday", "month")


@dataclass
class Source:
    """One restaurant's data. A restaurant query has one; a platform query has one per restaurant."""

    tid: str
    name: str
    tz: str
    tdb: TenantDB
    exclusive_tax: bool = False


def parse_filters(raw: list[str] | None, allowed: set[str]) -> list[tuple[str, str]]:
    out = []
    for f in raw or []:
        dim, _, val = f.partition(":")
        if dim not in DIMENSIONS or dim not in allowed or not val or len(val) > 80:
            raise bad_request("BAD_FILTER", "Unknown filter")
        out.append((dim, val))
    if len(out) > 8:
        raise bad_request("BAD_FILTER", "Too many filters")
    return out


def parse_range(frm: str | None, to: str | None, today: str) -> tuple[str, str]:
    try:
        t = date.fromisoformat(to) if to else date.fromisoformat(today)
        f = date.fromisoformat(frm) if frm else t - timedelta(days=6)
    except ValueError as e:
        raise bad_request("BAD_DATE", "Dates must look like 2026-10-31") from e
    if f > t or (t - f).days >= MAX_DAYS:
        raise bad_request("BAD_RANGE", f"Choose a range of at most {MAX_DAYS} days")
    return f.isoformat(), t.isoformat()


def _modes(b: dict) -> dict[str, int]:
    """Money kept per payment mode: payments minus refunds."""
    m: dict[str, int] = defaultdict(int)
    for p in b.get("payments", []):
        m[p["mode"]] += p["amount"]
    for r in b.get("refunds", []):
        m[r["mode"]] -= r["amount"]
    return {k: v for k, v in m.items() if v or k}


def _state(b: dict) -> str:
    return b["online"]["status"] if b.get("channel") == "online" else b["status"]


def _coupon(b: dict) -> str:
    c = (b.get("online") or {}).get("coupon")
    if c:
        return c["code"]
    d = b.get("discount")
    return "Manual discount" if d and d.get("value") else "None"


def _local(b: dict, tz: str) -> datetime:
    try:
        return datetime.fromisoformat(b["created_at"]).astimezone(ZoneInfo(tz))
    except (ValueError, KeyError):
        return datetime.now(UTC)


def bill_dims(b: dict, src: Source, multi: bool) -> dict[str, str | tuple]:
    """Value of every bill-level dimension: (key, label)."""
    loc = _local(b, src.tz)
    cust = b.get("customer") or {}
    online = b.get("online") or {}
    dims = {
        "day": (b["business_date"], b["business_date"]),
        "month": (b["business_date"][:7], b["business_date"][:7]),
        "hour": (f"{loc.hour:02d}", f"{loc.hour:02d}:00"),
        "weekday": (str(loc.weekday()), WEEKDAYS[loc.weekday()]),
        "channel": ("online", "Online orders") if b.get("channel") == "online" else ("counter", "Counter"),
        "type": (b["type"], b["type"]),
        "status": (_state(b), _state(b).replace("_", " ").title()),
        "customer": (cust.get("phone") or "walk-in", cust.get("name") or cust.get("phone") or "Walk-in"),
        "coupon": (_coupon(b), _coupon(b)),
        "rider": ((online.get("driver") or {}).get("id", "none"), (online.get("driver") or {}).get("name", "No rider")),
        "table": (b.get("table") or "none", b.get("table") or "No table"),
    }
    if multi:
        dims["restaurant"] = (src.tid, src.name)
    return dims


def line_dims(ln: dict, cats: dict[str, str]) -> dict[str, tuple[str, str]]:
    cat = cats.get(ln.get("item_id", ""), "Other")
    return {"item": (ln["name"], ln["name"]), "category": (cat, cat)}


async def collect(sources: list[Source], frm: str, to: str, scope: str, filters: list[tuple[str, str]], multi: bool) -> tuple[list[dict], bool]:
    """Facts: one per bill that passes the filters, with everything the breakdown needs already worked out."""
    facts: list[dict] = []
    truncated = False
    for src in sources:
        cats = {}
        async for it in src.tdb.menu_items.find({}):
            cats[str(it["_id"])] = it.get("category") or "Other"
        flt = {"business_date": {"$gte": frm, "$lte": to}}
        if scope == "sales":
            flt["status"] = {"$in": ["paid", "refunded"]}
        n = 0
        async for b in src.tdb.bills.find(flt).sort("created_at", 1):
            n += 1
            if len(facts) >= MAX_BILLS:
                truncated = True
                break
            if b["status"] in ("paid", "refunded"):
                sales = calc.paid_amount(b)
            else:
                sales = 0
            dims = bill_dims(b, src, multi)
            modes = _modes(b)
            tot = b["totals"]
            lines = []
            for ln, t in zip([x for x in b["lines"] if x["qty"] > 0], tot.get("lines", []), strict=False):
                if ln.get("fee"):
                    continue
                v = t["value"] - t["discount"] + (t["tax"] if src.exclusive_tax else 0)
                lines.append({"qty": ln["qty"], "sales": v if sales else 0, **line_dims(ln, cats)})
            fact = {"bill": b, "src": src, "dims": dims, "modes": modes, "lines": lines, "sales": sales, "discount": tot["discount"], "tax": tot["tax"]}
            if all(_match(fact, d, v) for d, v in filters):
                facts.append(fact)
    return facts, truncated


def _match(fact: dict, dim: str, val: str) -> bool:
    kind = DIMENSIONS[dim][1]
    if kind == "bill":
        return fact["dims"][dim][0] == val if dim in fact["dims"] else False
    if kind == "payment":
        return val in fact["modes"]
    return any(ln[dim][0] == val for ln in fact["lines"])


def _row(key: str, label: str) -> dict:
    return {"key": key, "label": label, "sales": 0, "orders": 0, "items": 0, "discount": 0, "tax": 0, "_bills": set()}


def breakdown(facts: list[dict], by: str, filters: list[tuple[str, str]]) -> list[dict]:
    kind = DIMENSIONS[by][1]
    rows: dict[str, dict] = {}
    for f in facts:
        bid = str(f["bill"]["_id"])
        if kind == "bill":
            if by not in f["dims"]:
                continue
            k, label = f["dims"][by]
            r = rows.setdefault(k, _row(k, label))
            r["sales"] += f["sales"]
            r["discount"] += f["discount"]
            r["tax"] += f["tax"]
            r["items"] += sum(ln["qty"] for ln in f["lines"])
            r["_bills"].add(bid)
        elif kind == "payment":
            for mode, amt in f["modes"].items():
                r = rows.setdefault(mode, _row(mode, mode.upper() if len(mode) <= 4 else mode.title()))
                r["sales"] += amt
                r["_bills"].add(bid)
        else:
            picked = [ln for ln in f["lines"] if all(ln[d][0] == v for d, v in filters if d == by)] if any(d == by for d, _ in filters) else f["lines"]
            for ln in picked:
                k, label = ln[by]
                r = rows.setdefault(k, _row(k, label))
                r["sales"] += ln["sales"]
                r["items"] += ln["qty"]
                r["_bills"].add(bid)
    out = []
    for r in rows.values():
        r["orders"] = len(r.pop("_bills"))
        r["avg_bill"] = r["sales"] // r["orders"] if r["orders"] else 0
        out.append(r)
    return out


def finish(rows: list[dict], by: str, frm: str, to: str) -> list[dict]:
    """Order rows for display, fill the gaps in time-like dimensions, add each row's share of the total."""
    if by == "day":
        have = {r["key"]: r for r in rows}
        d, end = date.fromisoformat(frm), date.fromisoformat(to)
        rows = []
        while d <= end:
            k = d.isoformat()
            rows.append(have.get(k) or {**_row(k, k), "orders": 0, "avg_bill": 0, "_bills": None})
            d += timedelta(days=1)
        for r in rows:
            r.pop("_bills", None)
    elif by == "hour":
        have = {r["key"]: r for r in rows}
        rows = [
            have.get(f"{h:02d}") or {"key": f"{h:02d}", "label": f"{h:02d}:00", "sales": 0, "orders": 0, "items": 0, "discount": 0, "tax": 0, "avg_bill": 0}
            for h in range(24)
        ]
    elif by == "weekday":
        have = {r["key"]: r for r in rows}
        rows = [
            have.get(str(i)) or {"key": str(i), "label": WEEKDAYS[i], "sales": 0, "orders": 0, "items": 0, "discount": 0, "tax": 0, "avg_bill": 0}
            for i in range(7)
        ]
    elif by == "month":
        rows = sorted(rows, key=lambda r: r["key"])
    else:
        rows = sorted(rows, key=lambda r: (-r["sales"], -r["orders"], r["label"]))
    total = sum(r["sales"] for r in rows) or 0
    for r in rows:
        r["share"] = round(r["sales"] / total, 4) if total else 0
    return rows


def totals(facts: list[dict]) -> dict:
    sales = sum(f["sales"] for f in facts)
    orders = len(facts)
    return {
        "sales": sales,
        "orders": orders,
        "avg_bill": sales // orders if orders else 0,
        "items": sum(sum(ln["qty"] for ln in f["lines"]) for f in facts),
        "discount": sum(f["discount"] for f in facts),
        "tax": sum(f["tax"] for f in facts),
    }


def previous_range(frm: str, to: str) -> tuple[str, str]:
    f, t = date.fromisoformat(frm), date.fromisoformat(to)
    span = (t - f).days + 1
    return (f - timedelta(days=span)).isoformat(), (f - timedelta(days=1)).isoformat()


def record(f: dict, multi: bool) -> dict:
    b = f["bill"]
    online = b.get("online") or {}
    cust = b.get("customer") or {}
    out = {
        "id": str(b["_id"]),
        "order_no": b["bill_no"],
        "created_at": b["created_at"],
        "business_date": b["business_date"],
        "type": b["type"],
        "channel": "online" if b.get("channel") == "online" else "counter",
        "state": _state(b),
        "customer": cust.get("name") or "",
        "phone": cust.get("phone") or "",
        "total": b["totals"]["total"],
        "net": f["sales"],
        "discount": f["discount"],
        "modes": sorted(f["modes"]),
        "table": b.get("table") or "",
        "rider": (online.get("driver") or {}).get("name", ""),
        "coupon": _coupon(b),
        "items": [f"{ln['qty']}x {ln['name']}" for ln in b["lines"] if not ln.get("fee") and ln["qty"] > 0],
    }
    if multi:
        out["restaurant"] = f["src"].name
        out["restaurant_id"] = f["src"].tid
    return out
