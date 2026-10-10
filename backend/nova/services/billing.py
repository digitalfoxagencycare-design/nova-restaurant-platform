"""Bill lifecycle: lines + notes, discounts, KOT, split, payment, void, reopen, refund. Every sensitive step is
permission-gated, limit-checked, reason-checked and audited. Money is integer paise; see billing/calc.py."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from bson import ObjectId
from bson.errors import InvalidId

from ..api.deps import Principal
from ..billing import calc
from ..core.errors import ApiError, bad_request, not_found
from ..core.permissions import has_permission, limit_for
from ..tenancy.db import TenantDB
from . import approvals
from .audit import audit

BILL_TYPES = ("Dine-in", "Takeaway", "Delivery")
PAY_MODES = ("cash", "upi", "card")
MAX_OPEN_BILLS_PER_USER = 12
MAX_NOTE = 140


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(dt: datetime | None = None) -> str:
    return (dt or _now()).isoformat()


def _oid(v: str) -> ObjectId:
    try:
        return ObjectId(v)
    except (InvalidId, TypeError) as e:
        raise not_found("Bill not found") from e


def business_date(cfg: dict) -> str:
    """The restaurant's trading day: before ``business_day_start`` still counts as yesterday."""
    tz = ZoneInfo(cfg["locale"]["timezone"])
    hh, mm = map(int, cfg["operations"]["business_day_start"].split(":"))
    now = _now().astimezone(tz)
    day = now.date() if (now.hour, now.minute) >= (hh, mm) else (now - timedelta(days=1)).date()
    return day.isoformat()


def _tax(cfg: dict) -> tuple[float, str]:
    return float(cfg["tax"]["default_rate"]), cfg["tax"]["mode"]


def present(b: dict) -> dict:
    out = {k: v for k, v in b.items() if k not in ("_id", "tenant_id")}
    out["id"] = str(b["_id"])
    out["paid"] = calc.paid_amount(b)
    out["balance"] = calc.balance(b)
    return out


def _reasons(cfg: dict) -> set[str]:
    return set(((cfg.get("pos") or {}).get("reasons_required")) or ["void", "void_item", "refund", "reopen"])


def _need_reason(cfg: dict, kind: str, reason: str | None) -> str:
    reason = (reason or "").strip()
    if kind in _reasons(cfg) and len(reason) < 3:
        raise bad_request("REASON_REQUIRED", "Please give a short reason")
    return reason[:200]


async def _authorize(tdb: TenantDB, p: Principal, perm: str, token: str | None, settings, bill_id: str = "") -> str:
    """Return the actor to record. Allowed outright, or by a manager's one-time approval for this exact permission."""
    if has_permission(p.permissions, perm):
        return p.email
    if token:
        approver = await approvals.consume(tdb, settings, token, perm, p, bill_id)
        return f"{p.email} (approved by {approver})"
    raise ApiError(403, "APPROVAL_REQUIRED", f"{perm} needs a manager's approval", permission=perm)


async def _load(tdb: TenantDB, bill_id: str) -> dict:
    b = await tdb.bills.find_one({"_id": _oid(bill_id)})
    if not b:
        raise not_found("Bill not found")
    return b


def _history(b: dict, actor: str, action: str, detail: dict | None = None) -> None:
    b.setdefault("history", []).append({"ts": _iso(), "by": actor, "action": action, **({"detail": detail} if detail else {})})


async def _save(tdb: TenantDB, b: dict, cfg: dict, expected_revision: int | None) -> dict:
    rate, mode = _tax(cfg)
    b["totals"] = calc.compute(b["lines"], b.get("discount"), rate, mode).as_dict()
    rev = b["revision"]
    if expected_revision is not None and expected_revision != rev:
        raise ApiError(409, "STALE_BILL", "This bill was changed on another screen. Refresh and try again.")
    b["revision"] = rev + 1
    r = await tdb.bills.update_one({"_id": b["_id"], "revision": rev}, {"$set": {k: v for k, v in b.items() if k not in ("_id", "tenant_id")}})
    if r.matched_count != 1:
        raise ApiError(409, "STALE_BILL", "This bill was changed on another screen. Refresh and try again.")
    return b


def _check_note(note: str | None) -> str:
    note = (note or "").strip()
    if len(note) > MAX_NOTE:
        raise bad_request("NOTE_TOO_LONG", f"Notes can be up to {MAX_NOTE} characters")
    return note


# ------------------------------------------------------------------ create / lines
async def create_bill(tdb: TenantDB, p: Principal, cfg: dict, body: dict) -> dict:
    btype = body.get("type", "Dine-in")
    if btype not in BILL_TYPES:
        raise bad_request("BAD_TYPE", "Unknown bill type")
    if await tdb.bills.count_documents({"status": "open", "created_by": p.email}) >= MAX_OPEN_BILLS_PER_USER:
        raise bad_request("TOO_MANY_OPEN", "Too many open bills. Finish or void some first.")
    seq = (await tdb.counters.find_one_and_update({"key": "bill_no"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True))["seq"]
    tables = (cfg.get("pos") or {}).get("tables")
    table = body.get("table")
    if btype == "Dine-in" and table and tables and table not in tables:
        raise bad_request("BAD_TABLE", "Unknown table")
    b = {
        "bill_no": 1000 + seq, "type": btype, "table": table if btype == "Dine-in" else None,
        "customer": {"phone": (body.get("phone") or "")[:15], "name": (body.get("name") or "")[:60]},
        "lines": [], "discount": None, "status": "open", "payments": [], "refunds": [], "history": [],
        "revision": 0, "kot_batches": 0, "reprints": 0, "created_by": p.email, "created_at": _iso(),
        "business_date": business_date(cfg), "totals": {"subtotal": 0, "discount": 0, "tax": 0, "total": 0, "lines": []},
    }
    _history(b, p.email, "create")
    res = await tdb.bills.insert_one(b)
    b["_id"] = res.inserted_id
    await audit(tdb, p.email, "bill.create", str(b["bill_no"]))
    return b


def _assert_open(b: dict) -> None:
    if b["status"] != "open":
        raise ApiError(409, "BILL_CLOSED", f"This bill is {b['status']}. Reopen it to change it.")


async def set_header(tdb, p, cfg, bill_id, body, revision=None):
    b = await _load(tdb, bill_id)
    _assert_open(b)
    if "type" in body:
        if body["type"] not in BILL_TYPES:
            raise bad_request("BAD_TYPE", "Unknown bill type")
        b["type"] = body["type"]
        if b["type"] != "Dine-in":
            b["table"] = None
    if "table" in body and b["type"] == "Dine-in":
        tables = (cfg.get("pos") or {}).get("tables")
        if body["table"] and tables and body["table"] not in tables:
            raise bad_request("BAD_TABLE", "Unknown table")
        b["table"] = body["table"]
    if "phone" in body or "name" in body:
        b["customer"] = {"phone": (body.get("phone", b["customer"]["phone"]) or "")[:15], "name": (body.get("name", b["customer"]["name"]) or "")[:60]}
    return await _save(tdb, b, cfg, revision)


async def add_line(tdb, p, cfg, bill_id, item_id: str, qty: int, note: str | None, revision=None):
    b = await _load(tdb, bill_id)
    _assert_open(b)
    if not 1 <= qty <= 99:
        raise bad_request("BAD_QTY", "Quantity must be between 1 and 99")
    item = await tdb.menu_items.find_one({"_id": _oid(item_id)})
    if not item:
        raise not_found("Dish not found")
    if not item.get("available", True):
        raise ApiError(409, "OUT_OF_STOCK", f"{item['name']} is out of stock")
    note = _check_note(note)
    # merge into an existing un-noted line of the same dish; noted lines stay separate (the kitchen reads the note)
    for ln in b["lines"]:
        if ln["item_id"] == item_id and ln["note"] == note and ln["qty"] > 0:
            ln["qty"] += qty
            break
    else:
        b["lines"].append({"lid": uuid.uuid4().hex[:8], "item_id": item_id, "name": item["name"], "price": int(item["price"]), "qty": qty,
                           "note": note, "station": item.get("station", "kitchen"), "kot_qty": 0,
                           **({"tax_rate": item["tax_rate"]} if item.get("tax_rate") is not None else {})})
    _history(b, p.email, "add", {"item": item["name"], "qty": qty})
    return await _save(tdb, b, cfg, revision)


def _find(b: dict, lid: str) -> dict:
    for ln in b["lines"]:
        if ln["lid"] == lid:
            return ln
    raise not_found("Line not found")


async def update_line(tdb, p, cfg, settings, bill_id, lid, body, revision=None):
    b = await _load(tdb, bill_id)
    _assert_open(b)
    ln = _find(b, lid)
    actor = p.email
    if "note" in body:
        ln["note"] = _check_note(body["note"])
        _history(b, p.email, "note", {"item": ln["name"]})
    if "qty" in body:
        q = int(body["qty"])
        if not 0 <= q <= 99:
            raise bad_request("BAD_QTY", "Quantity must be between 0 and 99")
        if q < ln["kot_qty"]:
            # the kitchen already has it: removing it is a void and needs the right
            actor = await _authorize(tdb, p, "bills.void_item", body.get("approval_token"), settings, bill_id)
            reason = _need_reason(cfg, "void_item", body.get("reason"))
            _history(b, actor, "void_item", {"item": ln["name"], "from": ln["kot_qty"], "to": q, "reason": reason})
            await audit(tdb, actor, "bill.void_item", str(b["bill_no"]), {"item": ln["name"], "to": q, "reason": reason})
            ln["kot_qty"] = q
        else:
            _history(b, p.email, "qty", {"item": ln["name"], "to": q})
        ln["qty"] = q
        if q == 0:
            b["lines"] = [x for x in b["lines"] if x["lid"] != lid]
    return await _save(tdb, b, cfg, revision)


async def set_discount(tdb, p, cfg, settings, bill_id, body, revision=None):
    b = await _load(tdb, bill_id)
    _assert_open(b)
    kind, value = body.get("kind", "pct"), body.get("value", 0)
    if kind not in ("pct", "amount") or not isinstance(value, int | float) or value < 0:
        raise bad_request("BAD_DISCOUNT", "Discount must be a positive percent or amount")
    if kind == "pct" and value > 100:
        raise bad_request("BAD_DISCOUNT", "Discount cannot be above 100%")
    actor = p.email
    if value:
        if not has_permission(p.permissions, "bills.discount") and not body.get("approval_token"):
            raise ApiError(403, "APPROVAL_REQUIRED", "Discount needs a manager's approval", permission="bills.discount.override")
        rate, mode = _tax(cfg)
        sub = calc.compute(b["lines"], None, rate, mode).subtotal
        pct = (value / sub * 100) if (kind == "amount" and sub) else value
        cap = limit_for(p.role, "discount_max_pct", cfg)
        over = cap is not None and pct > cap
        if over or not has_permission(p.permissions, "bills.discount"):
            actor = await _authorize(tdb, p, "bills.discount.override", body.get("approval_token"), settings, bill_id)
        if "discount" in _reasons(cfg):
            _need_reason(cfg, "discount", body.get("reason"))
    b["discount"] = {"kind": kind, "value": value, "reason": (body.get("reason") or "")[:200], "by": actor} if value else None
    _history(b, actor, "discount", {"kind": kind, "value": value})
    await audit(tdb, actor, "bill.discount", str(b["bill_no"]), {"kind": kind, "value": value})
    return await _save(tdb, b, cfg, revision)


# ------------------------------------------------------------------ kitchen
async def send_kot(tdb: TenantDB, p: Principal, cfg: dict, bill_id: str) -> tuple[dict, list[dict]]:
    b = await _load(tdb, bill_id)
    _assert_open(b)
    fresh = [ln for ln in b["lines"] if ln["qty"] > ln["kot_qty"]]
    if not fresh:
        raise bad_request("NOTHING_NEW", "Nothing new to send to the kitchen")
    b["kot_batches"] += 1
    batch = b["kot_batches"]
    by_station: dict[str, list[dict]] = {}
    for ln in fresh:
        by_station.setdefault(ln.get("station", "kitchen"), []).append({"name": ln["name"], "qty": ln["qty"] - ln["kot_qty"], "note": ln["note"]})
        ln["kot_qty"] = ln["qty"]
    tickets = []
    for station, lines in by_station.items():
        t = {"bill_id": str(b["_id"]), "bill_no": b["bill_no"], "batch": batch, "station": station, "type": b["type"], "table": b["table"],
             "lines": lines, "status": "new", "created_at": _iso(), "updated_at": _iso()}
        # one ticket per (bill, batch, station): the unique index is (bill_id, batch), so suffix the batch for extra stations
        t["batch"], t["kot_no"] = batch * 10 + len(tickets), batch
        await tdb.kot_tickets.insert_one(t)
        tickets.append(t)
    _history(b, p.email, "kot", {"batch": batch})
    b = await _save(tdb, b, cfg, None)
    return b, tickets


KDS_NEXT = {"new": "cooking", "cooking": "ready", "ready": "served"}


async def advance_ticket(tdb: TenantDB, p: Principal, ticket_id: str) -> dict:
    t = await tdb.kot_tickets.find_one({"_id": _oid(ticket_id)})
    if not t:
        raise not_found("Ticket not found")
    nxt = KDS_NEXT.get(t["status"])
    if not nxt:
        raise ApiError(409, "TICKET_DONE", "This ticket is already finished")
    await tdb.kot_tickets.update_one({"_id": t["_id"], "status": t["status"]}, {"$set": {"status": nxt, "updated_at": _iso()}})
    t["status"] = nxt
    return t


# ------------------------------------------------------------------ split
async def split_bill(tdb, p, cfg, bill_id, picks: list[dict], revision=None):
    """Move chosen quantities to a new open bill (e.g. a table of four paying separately)."""
    b = await _load(tdb, bill_id)
    _assert_open(b)
    if not picks:
        raise bad_request("NOTHING_PICKED", "Pick what goes on the new bill")
    moved: list[dict] = []
    for pk in picks:
        ln = _find(b, pk["lid"])
        q = int(pk["qty"])
        if not 1 <= q <= ln["qty"]:
            raise bad_request("BAD_QTY", "Quantity to move is more than the bill has")
        moved.append({**ln, "lid": uuid.uuid4().hex[:8], "qty": q, "kot_qty": min(q, ln["kot_qty"], max(0, ln["kot_qty"] - (ln["qty"] - q)))})
        ln["qty"] -= q
        ln["kot_qty"] = min(ln["kot_qty"], ln["qty"])
    if all(ln["qty"] == 0 for ln in b["lines"]):
        raise bad_request("SPLIT_ALL", "Leave at least one item on the original bill")
    b["lines"] = [ln for ln in b["lines"] if ln["qty"] > 0]
    child = await create_bill(tdb, p, cfg, {"type": b["type"], "table": b["table"], "phone": b["customer"]["phone"], "name": b["customer"]["name"]})
    child["lines"] = moved
    child["split_from"] = b["bill_no"]
    _history(child, p.email, "split_from", {"bill": b["bill_no"]})
    _history(b, p.email, "split_to", {"bill": child["bill_no"]})
    child = await _save(tdb, child, cfg, None)
    b = await _save(tdb, b, cfg, revision)
    await audit(tdb, p.email, "bill.split", str(b["bill_no"]), {"to": child["bill_no"]})
    return b, child


# ------------------------------------------------------------------ pay / void / reopen / refund
async def pay(tdb, p, cfg, bill_id, payments: list[dict], idem_key: str | None):
    """Collect money. Several payments are allowed (cash + UPI, or one share per guest). Safe to retry with the same key."""
    if idem_key:
        seen = await tdb.idempotency.find_one({"key": f"pay:{bill_id}:{idem_key}"})
        if seen:
            return await _load(tdb, bill_id)
    b = await _load(tdb, bill_id)
    if b["status"] == "paid" and idem_key is None:
        raise ApiError(409, "BILL_CLOSED", "This bill is already paid")
    _assert_open(b)
    if not b["lines"]:
        raise bad_request("EMPTY_BILL", "Add items before collecting payment")
    if not payments:
        raise bad_request("NO_PAYMENT", "Enter how the customer is paying")
    owed = calc.balance(b)
    if owed <= 0:
        raise bad_request("NOTHING_DUE", "Nothing is due on this bill")
    recorded = []
    remaining = owed
    for pm in payments:
        mode, amount = pm.get("mode"), int(pm.get("amount", 0))
        if mode not in PAY_MODES or amount <= 0:
            raise bad_request("BAD_PAYMENT", "Payment needs a mode and an amount above zero")
        change = 0
        if amount > remaining:
            if mode != "cash":
                raise bad_request("OVERPAY", "UPI and card payments cannot be more than what is due")
            change = amount - remaining
        applied = amount - change
        recorded.append({"id": uuid.uuid4().hex[:8], "mode": mode, "amount": applied, "tendered": amount, "change": change,
                         "ref": (pm.get("ref") or "")[:40], "at": _iso(), "by": p.email})
        remaining -= applied
    b["payments"].extend(recorded)
    if remaining == 0:
        b["status"] = "paid"
        b["closed_at"] = _iso()
    _history(b, p.email, "pay", {"amount": owed - remaining, "left": remaining})
    b = await _save(tdb, b, cfg, None)
    if idem_key:
        await tdb.idempotency.update_one({"key": f"pay:{bill_id}:{idem_key}"}, {"$set": {"at": _iso()}}, upsert=True)
    await audit(tdb, p.email, "bill.pay", str(b["bill_no"]), {"paid": owed - remaining, "status": b["status"]})
    return b


async def void_bill(tdb, p, cfg, settings, bill_id, body):
    b = await _load(tdb, bill_id)
    _assert_open(b)
    if b["payments"]:
        raise bad_request("HAS_PAYMENTS", "Money was already taken. Refund it first.")
    sent = any(ln["kot_qty"] for ln in b["lines"])
    actor = p.email
    if sent or b["lines"]:
        actor = await _authorize(tdb, p, "bills.void", body.get("approval_token"), settings, bill_id)
    reason = _need_reason(cfg, "void", body.get("reason"))
    b["status"] = "void"
    b["void"] = {"reason": reason, "by": actor, "at": _iso()}
    _history(b, actor, "void", {"reason": reason})
    open_tickets = {"bill_id": str(b["_id"]), "status": {"$in": ["new", "cooking"]}}
    await tdb.kot_tickets.update_many(open_tickets, {"$set": {"status": "cancelled", "updated_at": _iso()}})
    await audit(tdb, actor, "bill.void", str(b["bill_no"]), {"reason": reason})
    return await _save(tdb, b, cfg, None)


async def reopen(tdb, p, cfg, settings, bill_id, body):
    """Edit a paid bill. Allowed only inside the role's time window, with a reason, and always audited."""
    b = await _load(tdb, bill_id)
    if b["status"] != "paid":
        raise bad_request("NOT_PAID", "Only a paid bill can be reopened")
    actor = await _authorize(tdb, p, "bills.reopen", body.get("approval_token"), settings, bill_id)
    window = limit_for(p.role, "reopen_window_minutes", cfg)
    if window is not None and not body.get("approval_token"):
        closed = datetime.fromisoformat(b["closed_at"])
        if _now() - closed > timedelta(minutes=window):
            raise ApiError(403, "WINDOW_PASSED", "This bill is too old for you to edit. Ask the owner.")
    reason = _need_reason(cfg, "reopen", body.get("reason"))
    b["status"] = "open"
    b["reopened"] = b.get("reopened", 0) + 1
    _history(b, actor, "reopen", {"reason": reason, "total_before": b["totals"]["total"]})
    await audit(tdb, actor, "bill.reopen", str(b["bill_no"]), {"reason": reason})
    return await _save(tdb, b, cfg, None)


async def refund(tdb, p, cfg, settings, bill_id, body):
    b = await _load(tdb, bill_id)
    amount, mode = int(body.get("amount", 0)), body.get("mode")
    if amount <= 0 or mode not in PAY_MODES:
        raise bad_request("BAD_REFUND", "Refund needs an amount and how it is returned")
    refundable = calc.paid_amount(b) - max(0, b["totals"]["total"]) if b["status"] == "open" else calc.paid_amount(b)
    if amount > refundable:
        raise bad_request("REFUND_TOO_BIG", "You cannot refund more than was paid")
    actor = await _authorize(tdb, p, "bills.refund", body.get("approval_token"), settings, bill_id)
    cap = limit_for(p.role, "refund_max_paise", cfg)
    if cap is not None and amount > cap and not body.get("approval_token"):
        raise ApiError(403, "APPROVAL_REQUIRED", "This refund is above your limit and needs the owner's approval", permission="bills.refund")
    reason = _need_reason(cfg, "refund", body.get("reason"))
    b["refunds"].append({"id": uuid.uuid4().hex[:8], "amount": amount, "mode": mode, "reason": reason, "by": actor, "at": _iso()})
    if calc.paid_amount(b) == 0 and b["status"] == "paid":
        b["status"] = "refunded"
    elif b["status"] == "open" and b["lines"] and calc.balance({**b, "refunds": b["refunds"]}) <= 0:
        b["status"] = "paid"  # an edited bill whose difference has been returned is settled again
    _history(b, actor, "refund", {"amount": amount, "reason": reason})
    await audit(tdb, actor, "bill.refund", str(b["bill_no"]), {"amount": amount, "mode": mode, "reason": reason})
    return await _save(tdb, b, cfg, None)
