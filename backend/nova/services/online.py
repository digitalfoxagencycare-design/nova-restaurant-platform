"""Online ordering on top of the bill model: a customer order IS a bill with ``channel == "online"``.

That keeps one source of truth: the kitchen screen, the day report, receipts and refunds all work for online orders
without a second system. The customer-facing life cycle lives in ``bill["online"]["status"]`` and follows the tenant's
``operations.flows`` for the order type; billing status (open/paid/void) is separate.

Money is integer paise everywhere. Prices are always read from the menu on the server; the client only sends item ids.
"""
from __future__ import annotations

import math
import secrets
import uuid
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from ..api.deps import Principal
from ..billing import calc
from ..core.errors import ApiError, bad_request, not_found
from ..tenancy.db import TenantDB
from . import billing as svc
from .audit import audit

ONLINE_TYPES = {"dine-in": "Dine-in", "takeaway": "Takeaway", "delivery": "Delivery"}
DEFAULT_FLOWS = {
    "dine-in": ["placed", "preparing", "ready", "served", "completed"],
    "takeaway": ["placed", "preparing", "ready", "completed"],
    "delivery": ["placed", "preparing", "ready", "out_for_delivery", "delivered"],
}
FINAL = {"completed", "delivered", "cancelled"}
MAX_ACTIVE_PER_CUSTOMER = 5
MAX_LINES = 40


def _now() -> datetime:
    return datetime.now(UTC)


def _iso() -> str:
    return _now().isoformat()


def system_principal(tenant_id: str, cfg: dict) -> Principal:
    return Principal("tenant", "system", "system", "system@nova", tenant_id, frozenset({"*"}), cfg)


def flow_for(cfg: dict, otype: str) -> list[str]:
    return list(((cfg.get("operations") or {}).get("flows") or {}).get(otype) or DEFAULT_FLOWS[otype])


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def _hhmm_in(now_local: datetime, a: str, b: str) -> bool:
    cur = now_local.strftime("%H:%M")
    return (a <= cur < b) if a <= b else (cur >= a or cur < b)   # windows may cross midnight (22:00 to 06:00)


def cod_available(cfg: dict) -> bool:
    cod = ((cfg.get("payments") or {}).get("cod")) or {}
    if cod.get("enabled") is False:
        return False
    local = _now().astimezone(ZoneInfo(cfg["locale"]["timezone"]))
    return not any(_hhmm_in(local, w["from"], w["to"]) for w in cod.get("disabled_windows", []))


def delivery_fee_paise(cfg: dict, km: float, food_paise: int) -> int:
    d = cfg.get("delivery") or {}
    if d.get("free_above") is not None and food_paise >= int(round(d["free_above"] * 100)):
        return 0
    for slab in d.get("fee_slabs") or []:
        if km <= slab["up_to_km"]:
            return int(round(slab["fee"] * 100))
    return 0


# ------------------------------------------------------------------ public read models
def storefront(tenant: dict) -> dict:
    cfg = tenant["config"]
    o, d = cfg.get("ordering") or {}, cfg.get("delivery") or {}
    return {
        "slug": tenant["slug"], "brand": cfg["brand"], "locale": cfg["locale"],
        "ordering": {"channels": o.get("channels") or list(ONLINE_TYPES), "min_order": int(round(o.get("min_order", 0) * 100)),
                     "paused": bool(o.get("paused")), "notice": o.get("notice", ""), "prep_minutes": o.get("prep_minutes", 25)},
        "delivery": {"max_km": d.get("max_km"), "free_above": d.get("free_above"), "fee_slabs": d.get("fee_slabs", []), "origin": d.get("origin")},
        "payments": {"cod": cod_available(cfg), "online": False},
        "tables": (cfg.get("pos") or {}).get("tables") or [],
        "loyalty": {"enabled": bool((cfg.get("loyalty") or {}).get("enabled"))},
        "tax": {"mode": cfg["tax"]["mode"]},
    }


async def public_menu(tdb: TenantDB) -> dict:
    items = []
    async for it in tdb.menu_items.find({}).sort([("category", 1), ("name", 1)]):
        items.append({"id": str(it["_id"]), "name": it["name"], "price": int(it["price"]), "category": it["category"], "veg": it.get("veg"),
                      "available": it.get("available", True), "description": it.get("description", ""), "image_url": it.get("image_url", "")})
    cats: list[str] = []
    for i in items:
        if i["category"] not in cats:
            cats.append(i["category"])
    return {"categories": cats, "items": items}


def _expired(valid_to: str | None) -> bool:
    """``valid_to`` may be a date (valid through the end of that day, UTC) or a full timestamp."""
    if not valid_to:
        return False
    try:
        end = datetime.fromisoformat(valid_to)
    except ValueError:
        return True
    if len(valid_to) <= 10:
        end = end.replace(hour=23, minute=59, second=59)
    if end.tzinfo is None:
        end = end.replace(tzinfo=UTC)
    return end < _now()


# ------------------------------------------------------------------ pricing
async def price_cart(tdb: TenantDB, cfg: dict, body: dict) -> dict:
    """Validate a cart and return everything the bill needs. Raises ApiError with stable codes."""
    otype = body.get("type")
    if otype not in ONLINE_TYPES:
        raise bad_request("BAD_TYPE", "Choose delivery, takeaway or dine-in")
    ordering = cfg.get("ordering") or {}
    if otype not in (ordering.get("channels") or list(ONLINE_TYPES)):
        raise ApiError(409, "CHANNEL_OFF", f"{otype} orders are not available right now")
    if ordering.get("paused"):
        raise ApiError(409, "STORE_PAUSED", ordering.get("notice") or "Online ordering is paused right now")
    raw = body.get("items") or []
    if not raw or len(raw) > MAX_LINES:
        raise bad_request("BAD_CART", "Add at least one item")
    lines, seen = [], {}
    for r in raw:
        qty = int(r.get("qty", 0))
        if not 1 <= qty <= 99:
            raise bad_request("BAD_QTY", "Quantity must be between 1 and 99")
        note = (r.get("note") or "").strip()[:svc.MAX_NOTE]
        try:
            item = await tdb.menu_items.find_one({"_id": svc._oid(r.get("item_id", ""))})
        except ApiError:
            item = None
        if not item:
            raise not_found("A dish in your cart is no longer on the menu")
        if not item.get("available", True):
            raise ApiError(409, "OUT_OF_STOCK", f"{item['name']} is sold out", item_id=str(item["_id"]))
        key = (str(item["_id"]), note)
        if key in seen:
            seen[key]["qty"] += qty
            continue
        ln = {"lid": uuid.uuid4().hex[:8], "item_id": str(item["_id"]), "name": item["name"], "price": int(item["price"]), "qty": qty, "note": note,
              "station": item.get("station", "kitchen"), "kot_qty": 0, **({"tax_rate": item["tax_rate"]} if item.get("tax_rate") is not None else {})}
        seen[key] = ln
        lines.append(ln)
    food = sum(calc.line_value(ln) for ln in lines)
    if food < int(round(ordering.get("min_order", 0) * 100)):
        raise ApiError(409, "BELOW_MINIMUM", f"Minimum order is ₹{ordering['min_order']:g}", min_order=int(round(ordering["min_order"] * 100)))

    table, address, km, fee = None, None, None, 0
    if otype == "dine-in":
        tables = (cfg.get("pos") or {}).get("tables") or []
        table = (body.get("table") or "").strip()[:12]
        if not table or (tables and table not in tables):
            raise bad_request("BAD_TABLE", "Scan the table QR or pick your table")
    if otype == "delivery":
        a = body.get("address") or {}
        text = (a.get("text") or "").strip()
        if len(text) < 6:
            raise bad_request("ADDRESS_REQUIRED", "Enter your delivery address")
        origin = (cfg.get("delivery") or {}).get("origin")
        lat, lng = a.get("lat"), a.get("lng")
        max_km = (cfg.get("delivery") or {}).get("max_km")
        if origin and lat is not None and lng is not None:
            km = round(haversine_km((origin["lat"], origin["lng"]), (float(lat), float(lng))), 2)
            if max_km is not None and km > max_km:
                raise ApiError(409, "OUT_OF_DELIVERY_RANGE", f"We deliver within {max_km:g} km", distance_km=km, max_km=max_km)
        elif origin and max_km is not None:
            raise bad_request("LOCATION_REQUIRED", "Pin your location on the map so we can check the distance")
        address = {"text": text[:200], "landmark": (a.get("landmark") or "")[:80], "lat": lat, "lng": lng}
        fee = delivery_fee_paise(cfg, km or 0.0, food)
        if fee:
            lines.append({"lid": uuid.uuid4().hex[:8], "item_id": "fee:delivery", "name": "Delivery fee", "price": fee, "qty": 1, "note": "",
                          "station": "fee", "kot_qty": 1, "fee": True, "tax_rate": 0})

    discount, coupon = None, None
    code = (body.get("coupon") or "").strip().upper()
    if code:
        c = await tdb.coupons.find_one({"code": code})
        if not c or not c.get("active", True) or _expired(c.get("valid_to")):
            raise ApiError(409, "COUPON_INVALID", "This offer is not valid")
        if food < int(c.get("min_subtotal", 0)):
            raise ApiError(409, "COUPON_MIN", f"Add ₹{(c['min_subtotal'] - food) / 100:g} more to use {code}", min_subtotal=int(c["min_subtotal"]))
        amt = calc.discount_amount(food, {"kind": c["kind"], "value": c["value"]})
        if c.get("max_discount"):
            amt = min(amt, int(c["max_discount"]))
        if amt > 0:
            discount = {"kind": "amount", "value": amt, "reason": f"coupon {code}", "by": "customer"}
            coupon = {"code": code, "title": c.get("title", ""), "saves": amt}

    rate, mode = float(cfg["tax"]["default_rate"]), cfg["tax"]["mode"]
    totals = calc.compute(lines, discount, rate, mode).as_dict()
    return {"type": otype, "lines": lines, "discount": discount, "coupon": coupon, "totals": totals, "table": table, "address": address,
            "distance_km": km, "delivery_fee": fee, "food_subtotal": food}


def quote_view(priced: dict) -> dict:
    return {"type": priced["type"], "totals": {k: v for k, v in priced["totals"].items() if k != "lines"}, "delivery_fee": priced["delivery_fee"],
            "distance_km": priced["distance_km"], "coupon": priced["coupon"], "lines": [_line_view(ln) for ln in priced["lines"]]}


def _line_view(ln: dict) -> dict:
    return {"item_id": ln["item_id"], "name": ln["name"], "price": ln["price"], "qty": ln["qty"], "note": ln.get("note", ""), "fee": bool(ln.get("fee"))}


# ------------------------------------------------------------------ placing
async def place_order(tdb: TenantDB, cfg: dict, customer: dict, body: dict, idem_key: str | None) -> dict:
    cid = str(customer["_id"])
    if idem_key:
        seen = await tdb.idempotency.find_one({"key": f"order:{cid}:{idem_key}"})
        if seen:
            return await svc._load(tdb, seen["bill_id"])
    active = await tdb.bills.count_documents({"channel": "online", "online.customer_id": cid, "online.status": {"$nin": list(FINAL)}})
    if active >= MAX_ACTIVE_PER_CUSTOMER:
        raise ApiError(409, "TOO_MANY_ACTIVE", "You already have several orders in progress")
    method = body.get("payment", "cod")
    if method != "cod":
        raise ApiError(409, "PAYMENT_NOT_AVAILABLE", "Pay when the order arrives (cash or UPI)")
    if not cod_available(cfg):
        raise ApiError(409, "COD_UNAVAILABLE", "Pay-on-delivery is not available at this hour")
    priced = await price_cart(tdb, cfg, body)
    otype = priced["type"]
    seq = (await tdb.counters.find_one_and_update({"key": "bill_no"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True))["seq"]
    now = _iso()
    notes = (body.get("notes") or "").strip()[:200]
    b = {
        "bill_no": 1000 + seq, "type": ONLINE_TYPES[otype], "table": priced["table"],
        "customer": {"phone": customer["phone"], "name": (body.get("name") or customer.get("name") or "")[:60]},
        "lines": priced["lines"], "discount": priced["discount"], "status": "open", "payments": [], "refunds": [], "history": [],
        "revision": 0, "kot_batches": 0, "reprints": 0, "created_by": f"customer:{customer['phone']}", "created_at": now,
        "business_date": svc.business_date(cfg), "totals": priced["totals"], "channel": "online",
        "online": {
            "status": "placed", "customer_id": cid, "type": otype, "address": priced["address"], "distance_km": priced["distance_km"],
            "payment_method": method, "notes": notes, "driver": None, "placed_at": now,
            "delivery_code": f"{secrets.randbelow(10**4):04d}" if otype == "delivery" else None, "delivery_code_tries": 0,
            "coupon": priced["coupon"], "timeline": [{"status": "placed", "at": now, "by": "customer"}],
        },
    }
    svc._history(b, f"customer:{customer['phone']}", "online_order")
    res = await tdb.bills.insert_one(b)
    b["_id"] = res.inserted_id
    if idem_key:
        await tdb.idempotency.update_one({"key": f"order:{cid}:{idem_key}"}, {"$set": {"at": now, "bill_id": str(b["_id"])}}, upsert=True)
    await audit(tdb, f"customer:{customer['phone']}", "order.place", str(b["bill_no"]), {"total": b["totals"]["total"], "type": otype})
    if (cfg.get("ordering") or {}).get("auto_accept"):
        b = await advance(tdb, cfg, b, "preparing", "system@nova")
    return b


# ------------------------------------------------------------------ status changes
def _need_online(b: dict) -> dict:
    if b.get("channel") != "online":
        raise ApiError(409, "NOT_ONLINE", "This is a counter bill. Manage it from the POS.")
    return b["online"]


async def advance(tdb: TenantDB, cfg: dict, b: dict, to: str, actor: str, *, collect: dict | None = None, reason: str = "", via_driver: bool = False) -> dict:
    o = _need_online(b)
    cur, otype = o["status"], o["type"]
    if cur in FINAL:
        raise ApiError(409, "ORDER_CLOSED", f"This order is already {cur}")
    flow = flow_for(cfg, otype)
    now = _iso()
    if to == "cancelled":
        if cur == "out_for_delivery":
            raise ApiError(409, "ALREADY_OUT", "The order is already out for delivery")
        reason = (reason or "").strip()
        if len(reason) < 3:
            raise bad_request("REASON_REQUIRED", "Please give a short reason")
        if b["payments"]:
            raise bad_request("HAS_PAYMENTS", "Money was already taken. Refund it first.")
        b["status"] = "void"
        b["void"] = {"reason": reason[:200], "by": actor, "at": now}
        await tdb.kot_tickets.update_many({"bill_id": str(b["_id"]), "status": {"$in": ["new", "cooking"]}},
                                          {"$set": {"status": "cancelled", "updated_at": now}})
        if o.get("driver"):
            o["driver"] = None
    else:
        if cur not in flow or to not in flow or flow.index(to) != flow.index(cur) + 1:
            raise ApiError(409, "BAD_TRANSITION", f"An order that is {cur} cannot become {to}")
        if to == "out_for_delivery" and not via_driver and not o.get("driver"):
            raise ApiError(409, "NO_DRIVER", "Assign a delivery partner first")
        if to == "preparing":
            sysp = system_principal(tdb.tenant_id, cfg)
            sent = await _send_kot_quiet(tdb, sysp, cfg, b)
            if sent:
                b = sent
        if to == flow[-1] and calc.balance(b) > 0:
            b = await _collect(tdb, cfg, b, collect, actor)
    o["status"] = to
    o.setdefault("timeline", []).append({"status": to, "at": now, "by": actor, **({"reason": reason} if reason else {})})
    b["online"] = o
    svc._history(b, actor, f"online_{to}", {"reason": reason} if reason else None)
    b = await svc._save(tdb, b, cfg, None)
    await audit(tdb, actor, f"order.{to}", str(b["bill_no"]), {"reason": reason} if reason else None)
    return b


async def _send_kot_quiet(tdb, p, cfg, b):
    fresh = [ln for ln in b["lines"] if ln["qty"] > ln["kot_qty"] and not ln.get("fee")]
    if not fresh:
        return None
    nb, _ = await svc.send_kot(tdb, p, cfg, str(b["_id"]))
    return nb


async def _collect(tdb, cfg, b, collect, actor):
    due = calc.balance(b)
    mode = (collect or {}).get("mode")
    if mode not in svc.PAY_MODES:
        raise ApiError(409, "PAYMENT_DUE", f"₹{due / 100:g} is still to be collected", due=due)
    p = system_principal(tdb.tenant_id, cfg)
    p = Principal(p.kind, p.user_id, p.role, actor, p.tenant_id, p.permissions, cfg)
    return await svc.pay(tdb, p, cfg, str(b["_id"]), [{"mode": mode, "amount": due, "ref": (collect or {}).get("ref", "")}], None)


async def assign_driver(tdb: TenantDB, cfg: dict, b: dict, driver: dict, actor: str) -> dict:
    o = _need_online(b)
    if o["type"] != "delivery" or o["status"] not in ("ready", "preparing"):
        raise ApiError(409, "NOT_ASSIGNABLE", "Only delivery orders that are being prepared or ready can be assigned")
    o["driver"] = {"id": str(driver["_id"]), "name": driver.get("name") or driver["email"], "phone": driver.get("phone", ""), "assigned_by": actor}
    b["online"] = o
    svc._history(b, actor, "assign_driver", {"driver": o["driver"]["name"]})
    return await svc._save(tdb, b, cfg, None)


# ------------------------------------------------------------------ presenters
def _clean(b: dict) -> dict:
    return {k: v for k, v in b.items() if k not in ("_id", "tenant_id", "history")}


def customer_view(b: dict) -> dict:
    o = b["online"]
    drv = o.get("driver") if o["status"] == "out_for_delivery" else None
    return {
        "id": str(b["_id"]), "order_no": b["bill_no"], "type": o["type"], "status": o["status"], "placed_at": o["placed_at"],
        "timeline": [{"status": t["status"], "at": t["at"]} for t in o.get("timeline", [])], "lines": [_line_view(ln) for ln in b["lines"]],
        "totals": {k: v for k, v in b["totals"].items() if k != "lines"}, "payment": {"method": o["payment_method"], "paid": b["status"] == "paid",
                                                                                      "due": max(0, calc.balance(b)) if b["status"] != "void" else 0},
        "address": o.get("address"), "table": b.get("table"), "notes": o.get("notes", ""), "coupon": o.get("coupon"),
        "delivery_code": o.get("delivery_code") if o["status"] not in FINAL else None,
        "driver": {"name": drv["name"], "phone": drv["phone"]} if drv else None,
        "driver_location": o.get("driver_loc") if drv else None,
    }


def staff_view(b: dict) -> dict:
    out = _clean(b)
    out["id"] = str(b["_id"])
    out["paid"] = calc.paid_amount(b)
    out["balance"] = calc.balance(b)
    if "online" in out:
        out["online"] = {k: v for k, v in out["online"].items() if k not in ("delivery_code", "delivery_code_tries")}
    out["state"] = b["online"]["status"] if b.get("channel") == "online" else b["status"]
    out["totals"] = {k: v for k, v in b["totals"].items() if k != "lines"}
    return out
