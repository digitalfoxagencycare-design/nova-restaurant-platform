"""Counter API: menu, bills, approvals, kitchen tickets, printing, end-of-day summary.

Every route resolves identity from the signed token (deps.py). Permission checks that depend on the bill (discount over a
limit, voids, refunds, reopen) live in services/billing.py, because a manager's PIN approval can stand in for them there.
"""
from __future__ import annotations

import base64
from typing import Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field

from ..core.config import Settings
from ..core.errors import ApiError, bad_request, not_found
from ..core.permissions import DEFAULT_LIMITS, POS_PERMISSIONS, ROLE_PERMISSIONS, effective_permissions, limit_for
from ..printing import render
from ..printing.escpos import PROFILES
from ..services import approvals
from ..services import billing as svc
from ..services.audit import audit
from ..tenancy.db import TenantDB
from .deps import Principal, get_settings, get_tdb, require_permission, require_tenant_principal

router = APIRouter(prefix="/v2/pos")

DEFAULT_TABLES = [f"T-{i:02d}" for i in range(1, 21)]


# ------------------------------------------------------------------ models
class PinIn(BaseModel):
    pin: str = Field(min_length=4, max_length=6)
    password: str


class ApprovalIn(BaseModel):
    pin: str = Field(min_length=4, max_length=6)
    permission: str
    bill_id: str = ""


class MenuIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    price: int = Field(ge=0, le=10_000_000, description="paise")
    category: str = Field(min_length=1, max_length=40)
    code: int | None = Field(default=None, ge=1, le=99999)
    station: str = "kitchen"
    veg: bool | None = None
    tax_rate: float | None = Field(default=None, ge=0, le=0.28)
    available: bool = True
    description: str = Field(default="", max_length=240)
    image_url: str = Field(default="", max_length=300)


class MenuPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    price: int | None = Field(default=None, ge=0, le=10_000_000)
    category: str | None = Field(default=None, min_length=1, max_length=40)
    station: str | None = None
    available: bool | None = None
    tax_rate: float | None = Field(default=None, ge=0, le=0.28)
    description: str | None = Field(default=None, max_length=240)
    image_url: str | None = Field(default=None, max_length=300)


class BillIn(BaseModel):
    type: Literal["Dine-in", "Takeaway", "Delivery"] = "Dine-in"
    table: str | None = None
    phone: str = ""
    name: str = ""


class HeaderPatch(BaseModel):
    type: Literal["Dine-in", "Takeaway", "Delivery"] | None = None
    table: str | None = None
    phone: str | None = None
    name: str | None = None
    revision: int | None = None


class LineIn(BaseModel):
    item_id: str
    qty: int = 1
    note: str = ""
    revision: int | None = None


class LinePatch(BaseModel):
    qty: int | None = None
    note: str | None = None
    reason: str | None = None
    approval_token: str | None = None
    revision: int | None = None


class DiscountIn(BaseModel):
    kind: Literal["pct", "amount"] = "pct"
    value: float = 0
    reason: str = ""
    approval_token: str | None = None
    revision: int | None = None


class Pick(BaseModel):
    lid: str
    qty: int


class SplitIn(BaseModel):
    picks: list[Pick]
    revision: int | None = None


class PayLine(BaseModel):
    mode: Literal["cash", "upi", "card"]
    amount: int = Field(gt=0, le=100_000_000)
    ref: str = ""


class PayIn(BaseModel):
    payments: list[PayLine] = Field(min_length=1, max_length=6)


class ReasonIn(BaseModel):
    reason: str = ""
    approval_token: str | None = None


class RefundIn(ReasonIn):
    amount: int = Field(gt=0)
    mode: Literal["cash", "upi", "card"]


class PrintIn(BaseModel):
    kind: Literal["receipt"] = "receipt"
    printer_id: str | None = None


class TestPrintIn(BaseModel):
    printer_id: str | None = None


def _oid(v: str) -> ObjectId:
    try:
        return ObjectId(v)
    except (InvalidId, TypeError) as e:
        raise not_found("Not found") from e


def _item(d: dict) -> dict:
    return {"id": str(d["_id"]), "name": d["name"], "price": d["price"], "category": d["category"], "code": d.get("code"),
            "station": d.get("station", "kitchen"), "veg": d.get("veg"), "available": d.get("available", True), "tax_rate": d.get("tax_rate"),
            "description": d.get("description", ""), "image_url": d.get("image_url", "")}


# ------------------------------------------------------------------ rules (what the screen may show)
@router.get("/rules")
async def rules(p: Principal = Depends(require_tenant_principal)):
    cfg = p.config or {}
    pos = cfg.get("pos") or {}
    return {
        "brand": cfg["brand"]["name"], "currency": cfg["locale"]["currency"], "tax": cfg["tax"],
        "tables": pos.get("tables") or DEFAULT_TABLES, "printers": pos.get("printers") or [], "profiles": {k: v.label for k, v in PROFILES.items()},
        "permissions": sorted(p.permissions & POS_PERMISSIONS) if "*" not in p.permissions else sorted(POS_PERMISSIONS),
        "limits": {k: limit_for(p.role, k, cfg) for k in DEFAULT_LIMITS}, "role": p.role,
        "reasons_required": pos.get("reasons_required") or ["void", "void_item", "refund", "reopen"],
    }


@router.get("/roles")
async def roles(p: Principal = Depends(require_permission("config.view"))):
    """The role matrix the owner edits: built-in rights, what this restaurant has changed, and the limits per role."""
    cfg = p.config or {}
    out = {}
    for role in ("manager", "cashier", "captain", "kitchen", "viewer"):
        out[role] = {
            "base": sorted(ROLE_PERMISSIONS[role] & POS_PERMISSIONS),
            "effective": sorted(effective_permissions(role, cfg) & POS_PERMISSIONS),
            "limits": {k: limit_for(role, k, cfg) for k in DEFAULT_LIMITS},
        }
    reasons = (cfg.get("pos") or {}).get("reasons_required") or ["void", "void_item", "refund", "reopen"]
    return {"roles": out, "catalog": sorted(POS_PERMISSIONS), "reasons_required": reasons}


@router.put("/me/pin", status_code=204)
async def set_pin(body: PinIn, p: Principal = Depends(require_tenant_principal), tdb: TenantDB = Depends(get_tdb)):
    await approvals.set_pin(tdb, p, body.pin, body.password)


@router.post("/approvals")
async def approve(body: ApprovalIn, p: Principal = Depends(require_tenant_principal), tdb: TenantDB = Depends(get_tdb), s: Settings = Depends(get_settings)):
    return await approvals.issue(tdb, s, p, body.pin, body.permission, body.bill_id)


# ------------------------------------------------------------------ menu
@router.get("/menu")
async def menu(tdb: TenantDB = Depends(get_tdb), _: Principal = Depends(require_permission("menu.view"))):
    return [_item(d) async for d in tdb.menu_items.find({}).sort([("category", 1), ("code", 1), ("name", 1)])]


@router.post("/menu", status_code=201)
async def menu_add(body: MenuIn, p: Principal = Depends(require_permission("menu.edit")), tdb: TenantDB = Depends(get_tdb)):
    if body.code and await tdb.menu_items.find_one({"code": body.code}):
        raise ApiError(409, "CODE_TAKEN", "That item code is already used")
    doc = body.model_dump(exclude_none=True)
    r = await tdb.menu_items.insert_one(doc)
    await audit(tdb, p.email, "menu.create", body.name)
    return _item({**doc, "_id": r.inserted_id})


@router.patch("/menu/{item_id}")
async def menu_patch(item_id: str, body: MenuPatch, p: Principal = Depends(require_tenant_principal), tdb: TenantDB = Depends(get_tdb)):
    changes = body.model_dump(exclude_none=True)
    if not changes:
        raise bad_request("NOTHING_TO_CHANGE", "Nothing to change")
    stock_only = set(changes) == {"available"}
    needed = "menu.stock" if stock_only else "menu.edit"
    if needed not in p.permissions and "*" not in p.permissions and "menu.edit" not in p.permissions:
        raise ApiError(403, "FORBIDDEN", f"Missing permission: {needed}")
    r = await tdb.menu_items.find_one_and_update({"_id": _oid(item_id)}, {"$set": changes}, return_document=True)
    if not r:
        raise not_found("Dish not found")
    await audit(tdb, p.email, "menu.update", r["name"], changes)
    return _item(r)


# ------------------------------------------------------------------ bills
@router.get("/bills")
async def bills(status: Literal["open", "paid", "void", "refunded"] = "open", limit: int = Query(50, ge=1, le=200),
                tdb: TenantDB = Depends(get_tdb), _: Principal = Depends(require_permission("bills.view"))):
    return [svc.present(b) async for b in tdb.bills.find({"status": status}).sort("created_at", -1).limit(limit)]


@router.post("/bills", status_code=201)
async def bill_create(body: BillIn, p: Principal = Depends(require_permission("bills.create")), tdb: TenantDB = Depends(get_tdb)):
    return svc.present(await svc.create_bill(tdb, p, p.config, body.model_dump()))


@router.get("/bills/{bill_id}")
async def bill_get(bill_id: str, tdb: TenantDB = Depends(get_tdb), _: Principal = Depends(require_permission("bills.view"))):
    return svc.present(await svc._load(tdb, bill_id))


@router.patch("/bills/{bill_id}")
async def bill_header(bill_id: str, body: HeaderPatch, p: Principal = Depends(require_permission("bills.edit")), tdb: TenantDB = Depends(get_tdb)):
    d = body.model_dump(exclude_unset=True)
    rev = d.pop("revision", None)
    return svc.present(await svc.set_header(tdb, p, p.config, bill_id, d, rev))


@router.post("/bills/{bill_id}/lines")
async def line_add(bill_id: str, body: LineIn, p: Principal = Depends(require_permission("bills.edit")), tdb: TenantDB = Depends(get_tdb)):
    return svc.present(await svc.add_line(tdb, p, p.config, bill_id, body.item_id, body.qty, body.note, body.revision))


@router.patch("/bills/{bill_id}/lines/{lid}")
async def line_patch(bill_id: str, lid: str, body: LinePatch, p: Principal = Depends(require_permission("bills.edit")),
                     tdb: TenantDB = Depends(get_tdb), s: Settings = Depends(get_settings)):
    d = body.model_dump(exclude_unset=True)
    rev = d.pop("revision", None)
    return svc.present(await svc.update_line(tdb, p, p.config, s, bill_id, lid, d, rev))


@router.put("/bills/{bill_id}/discount")
async def discount(bill_id: str, body: DiscountIn, p: Principal = Depends(require_permission("bills.view")),
                   tdb: TenantDB = Depends(get_tdb), s: Settings = Depends(get_settings)):
    d = body.model_dump()
    rev = d.pop("revision", None)
    return svc.present(await svc.set_discount(tdb, p, p.config, s, bill_id, d, rev))


@router.post("/bills/{bill_id}/kot")
async def kot(bill_id: str, p: Principal = Depends(require_permission("bills.edit")), tdb: TenantDB = Depends(get_tdb)):
    b, tickets = await svc.send_kot(tdb, p, p.config, bill_id)
    prints = []
    for t in tickets:
        pr = render.printer_for(p.config, "kot", station=t["station"])
        data = render.kot(p.config, t, pr)
        prints.append({"printer": _printer_out(pr), "data": base64.b64encode(data).decode(), "bytes": len(data), "station": t["station"]})
    return {"bill": svc.present(b), "prints": prints}


@router.post("/bills/{bill_id}/split")
async def split(bill_id: str, body: SplitIn, p: Principal = Depends(require_permission("bills.split")), tdb: TenantDB = Depends(get_tdb)):
    b, child = await svc.split_bill(tdb, p, p.config, bill_id, [x.model_dump() for x in body.picks], body.revision)
    return {"bill": svc.present(b), "new_bill": svc.present(child)}


@router.post("/bills/{bill_id}/pay")
async def pay(bill_id: str, body: PayIn, p: Principal = Depends(require_permission("bills.pay")), tdb: TenantDB = Depends(get_tdb),
              idem: str | None = Header(default=None, alias="Idempotency-Key", max_length=64)):
    return svc.present(await svc.pay(tdb, p, p.config, bill_id, [x.model_dump() for x in body.payments], idem))


@router.post("/bills/{bill_id}/void")
async def void(bill_id: str, body: ReasonIn, p: Principal = Depends(require_permission("bills.view")), tdb: TenantDB = Depends(get_tdb),
               s: Settings = Depends(get_settings)):
    return svc.present(await svc.void_bill(tdb, p, p.config, s, bill_id, body.model_dump()))


@router.post("/bills/{bill_id}/reopen")
async def reopen(bill_id: str, body: ReasonIn, p: Principal = Depends(require_permission("bills.view")), tdb: TenantDB = Depends(get_tdb),
                 s: Settings = Depends(get_settings)):
    return svc.present(await svc.reopen(tdb, p, p.config, s, bill_id, body.model_dump()))


@router.post("/bills/{bill_id}/refund")
async def refund(bill_id: str, body: RefundIn, p: Principal = Depends(require_permission("bills.view")), tdb: TenantDB = Depends(get_tdb),
                 s: Settings = Depends(get_settings)):
    return svc.present(await svc.refund(tdb, p, p.config, s, bill_id, body.model_dump()))


# ------------------------------------------------------------------ printing
def _printer_out(pr: dict) -> dict:
    return {"id": pr["id"], "name": pr["name"], "profile": pr["profile"], "windows_name": pr.get("windows_name", ""), "copies": pr.get("copies", 1)}


@router.post("/bills/{bill_id}/print")
async def print_bill(bill_id: str, body: PrintIn, p: Principal = Depends(require_permission("bills.print")), tdb: TenantDB = Depends(get_tdb)):
    """Receipt bytes for the cashier's print agent. The first print of a paid bill is free; later ones are marked
    DUPLICATE, counted and need ``bills.reprint``. A bill that is still open prints as often as the customer asks."""
    b = await svc._load(tdb, bill_id)
    dup = False
    if b["status"] in ("paid", "refunded"):
        if b["reprints"] > 0 or b.get("printed"):
            if "bills.reprint" not in p.permissions and "*" not in p.permissions:
                raise ApiError(403, "FORBIDDEN", "Missing permission: bills.reprint")
            dup = True
            b["reprints"] += 1
            await tdb.bills.update_one({"_id": b["_id"]}, {"$set": {"reprints": b["reprints"]}})
            await audit(tdb, p.email, "bill.reprint", str(b["bill_no"]), {"count": b["reprints"]})
        else:
            await tdb.bills.update_one({"_id": b["_id"]}, {"$set": {"printed": True}})
    pr = render.printer_for(p.config, "receipt", body.printer_id)
    data = render.receipt(p.config, b, pr, duplicate=dup)
    return {"printer": _printer_out(pr), "data": base64.b64encode(data).decode(), "bytes": len(data), "duplicate": dup}


@router.post("/print/test")
async def print_test(body: TestPrintIn, p: Principal = Depends(require_permission("bills.print"))):
    pr = render.printer_for(p.config, "receipt", body.printer_id)
    data = render.test_slip(p.config, pr)
    return {"printer": _printer_out(pr), "data": base64.b64encode(data).decode(), "bytes": len(data)}


# ------------------------------------------------------------------ kitchen
@router.get("/kitchen")
async def kitchen(tdb: TenantDB = Depends(get_tdb), _: Principal = Depends(require_permission("kitchen.view"))):
    out = []
    async for t in tdb.kot_tickets.find({"status": {"$in": ["new", "cooking", "ready"]}}).sort("created_at", 1).limit(200):
        out.append({**{k: v for k, v in t.items() if k not in ("_id", "tenant_id")}, "id": str(t["_id"])})
    return out


@router.post("/kitchen/{ticket_id}/advance")
async def kitchen_advance(ticket_id: str, p: Principal = Depends(require_permission("kitchen.update")), tdb: TenantDB = Depends(get_tdb)):
    t = await svc.advance_ticket(tdb, p, ticket_id)
    return {**{k: v for k, v in t.items() if k not in ("_id", "tenant_id")}, "id": str(t["_id"])}


# ------------------------------------------------------------------ end of day
@router.get("/reports/day")
async def day_report(date: str | None = None, p: Principal = Depends(require_permission("reports.view")), tdb: TenantDB = Depends(get_tdb)):
    day = date or svc.business_date(p.config)
    paid = refunds = voids = discounts = 0
    by_mode: dict[str, int] = {}
    count = open_n = 0
    async for b in tdb.bills.find({"business_date": day}):
        if b["status"] in ("paid", "refunded"):
            count += 1
            paid += b["totals"]["total"]
            discounts += b["totals"]["discount"]
            for pay in b["payments"]:
                by_mode[pay["mode"]] = by_mode.get(pay["mode"], 0) + pay["amount"]
            for r in b["refunds"]:
                refunds += r["amount"]
                by_mode[r["mode"]] = by_mode.get(r["mode"], 0) - r["amount"]
        elif b["status"] == "void":
            voids += 1
        else:
            open_n += 1
    return {"date": day, "bills_paid": count, "sales": paid, "discounts": discounts, "refunds": refunds, "voided_bills": voids,
            "still_open": open_n, "by_mode": by_mode, "net_collected": sum(by_mode.values())}
