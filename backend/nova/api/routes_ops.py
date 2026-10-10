"""Owner/manager API used by the web admin and the owner app: orders (counter + online), overview, customers, offers,
tables, staff changes, store switch, menu bulk actions."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from ..billing import calc
from ..core.config import Settings
from ..core.errors import ApiError, bad_request, not_found
from ..core.permissions import ROLE_PERMISSIONS
from ..services import online as svc
from ..services import payments as pay_svc
from ..services import tenants as tenant_svc
from ..services import whatsapp as wa_svc
from ..services.audit import audit
from ..services.billing import _load, business_date
from ..tenancy.db import PlatformDB, TenantDB
from .deps import Principal, client_ip, get_platform_db, get_settings, get_tdb, get_tenant_record, require_permission
from .routes_pos import DEFAULT_TABLES

router = APIRouter(prefix="/v2")


def _oid(v: str) -> ObjectId:
    try:
        return ObjectId(v)
    except (InvalidId, TypeError) as e:
        raise not_found("Not found") from e


# ------------------------------------------------------------------ orders
def _row(b: dict) -> dict:
    online = b.get("channel") == "online"
    return {"id": str(b["_id"]), "order_no": b["bill_no"], "channel": b.get("channel", "pos"), "type": b["type"], "table": b.get("table"),
            "state": b["online"]["status"] if online else b["status"], "customer": b["customer"], "created_at": b["created_at"],
            "total": b["totals"]["total"], "paid": calc.paid_amount(b), "balance": calc.balance(b) if b["status"] != "void" else 0,
            "items": [f"{ln['qty']}× {ln['name']}" for ln in b["lines"] if not ln.get("fee")], "driver": (b.get("online") or {}).get("driver"),
            "address": ((b.get("online") or {}).get("address") or {}).get("text"), "notes": (b.get("online") or {}).get("notes", "")}


def _is_open(b: dict) -> bool:
    return b["online"]["status"] not in svc.FINAL if b.get("channel") == "online" else b["status"] == "open"


@router.get("/orders")
async def list_orders(scope: str = Query("open", pattern="^(open|done|cancelled|all)$"), channel: str = Query("all", pattern="^(all|online|pos)$"),
                      limit: int = Query(100, ge=1, le=300), tdb: TenantDB = Depends(get_tdb), _: Principal = Depends(require_permission("orders.view"))):
    flt = {} if channel == "all" else {"channel": "online"} if channel == "online" else {"channel": {"$ne": "online"}}
    out = []
    async for b in tdb.bills.find(flt).sort("created_at", -1).limit(600):
        if b.get("channel") == "online" and b["online"]["status"] == "pending_payment":
            continue            # not an order yet: the customer has not paid
        cancelled = b["status"] == "void" or (b.get("channel") == "online" and b["online"]["status"] == "cancelled")
        ok = {"all": True, "cancelled": cancelled, "open": not cancelled and _is_open(b), "done": not cancelled and not _is_open(b)}[scope]
        if ok:
            out.append(_row(b))
        if len(out) >= limit:
            break
    return out


@router.get("/orders/{order_id}")
async def get_order(order_id: str, tdb: TenantDB = Depends(get_tdb), _: Principal = Depends(require_permission("orders.view"))):
    b = await _load(tdb, order_id)
    return svc.staff_view(b)


class StatusIn(BaseModel):
    status: str
    reason: str = ""
    collect: dict | None = None


@router.post("/orders/{order_id}/status")
async def set_status(order_id: str, request: Request, body: StatusIn, p: Principal = Depends(require_permission("orders.update")),
                     tdb: TenantDB = Depends(get_tdb), t: dict = Depends(get_tenant_record)):
    b = await _load(tdb, order_id)
    rzp = await pay_svc.razorpay_for(request.app, p.tenant_id) if b["payments"] else None
    b = await svc.advance(tdb, p.config, b, body.status, p.email, collect=body.collect, reason=body.reason,
                          notify=wa_svc.Notifier(request.app, t), refunder=pay_svc.refunder(rzp, t) if rzp else None)
    return svc.staff_view(b)


class AssignIn(BaseModel):
    driver_id: str


@router.post("/orders/{order_id}/assign")
async def assign(order_id: str, body: AssignIn, p: Principal = Depends(require_permission("orders.update")), tdb: TenantDB = Depends(get_tdb)):
    b = await _load(tdb, order_id)
    d = await tdb.users.find_one({"_id": _oid(body.driver_id), "role": "delivery", "status": "active"})
    if not d:
        raise not_found("Delivery partner not found")
    return svc.staff_view(await svc.assign_driver(tdb, p.config, b, d, p.email))


@router.get("/delivery/drivers")
async def drivers(tdb: TenantDB = Depends(get_tdb), _: Principal = Depends(require_permission("orders.view"))):
    out = []
    async for u in tdb.users.find({"role": "delivery"}):
        uid = str(u["_id"])
        loc = await tdb.driver_locations.find_one({"driver_id": uid}) or {}
        active = await tdb.bills.count_documents({"channel": "online", "online.driver.id": uid, "online.status": "out_for_delivery"})
        out.append({"id": uid, "name": u.get("name") or u["email"], "phone": u.get("phone", ""), "status": u["status"], "online": bool(loc.get("online")),
                    "active_orders": active, "lat": loc.get("lat"), "lng": loc.get("lng"), "battery": loc.get("battery"), "seen_at": loc.get("updated_at")})
    return out


# ------------------------------------------------------------------ store switch
class StoreIn(BaseModel):
    paused: bool | None = None
    notice: str | None = Field(default=None, max_length=160)
    auto_accept: bool | None = None


@router.get("/store")
async def get_store(p: Principal = Depends(require_permission("orders.view"))):
    o = (p.config or {}).get("ordering") or {}
    return {"paused": bool(o.get("paused")), "notice": o.get("notice", ""), "auto_accept": bool(o.get("auto_accept"))}


@router.put("/store")
async def put_store(body: StoreIn, request: Request, p: Principal = Depends(require_permission("orders.update")), tdb: TenantDB = Depends(get_tdb),
                    pdb: PlatformDB = Depends(get_platform_db), s: Settings = Depends(get_settings)):
    t = await tenant_svc.get_by_id(pdb, p.tenant_id)
    cfg = {**t["config"], "ordering": {**(t["config"].get("ordering") or {})}}
    for k, v in body.model_dump(exclude_none=True).items():
        cfg["ordering"][k] = v
    await tenant_svc.update_config(pdb, s, p.tenant_id, cfg)
    await audit(tdb, p.email, "store.update", p.tenant_id, body.model_dump(exclude_none=True), client_ip(request))
    o = cfg["ordering"]
    return {"paused": bool(o.get("paused")), "notice": o.get("notice", ""), "auto_accept": bool(o.get("auto_accept"))}


# ------------------------------------------------------------------ overview
@router.get("/overview")
async def overview(date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"), tdb: TenantDB = Depends(get_tdb),
                   p: Principal = Depends(require_permission("reports.view"))):
    today = date or business_date(p.config)
    d0 = datetime.fromisoformat(today)
    days = [(d0 - timedelta(days=i)).date().isoformat() for i in range(6, -1, -1)]
    series = {d: 0 for d in days}
    sales = bills = 0
    by_mode: dict[str, int] = {}
    by_channel = {"online": 0, "pos": 0}
    items: dict[str, int] = {}
    async for b in tdb.bills.find({"business_date": {"$in": days}, "status": {"$in": ["paid", "refunded"]}}):
        net = calc.paid_amount(b)
        series[b["business_date"]] += net
        if b["business_date"] != today:
            continue
        sales += net
        bills += 1
        by_channel["online" if b.get("channel") == "online" else "pos"] += net
        for pay in b["payments"]:
            by_mode[pay["mode"]] = by_mode.get(pay["mode"], 0) + pay["amount"]
        for r in b["refunds"]:
            by_mode[r["mode"]] = by_mode.get(r["mode"], 0) - r["amount"]
        for ln in b["lines"]:
            if not ln.get("fee"):
                items[ln["name"]] = items.get(ln["name"], 0) + ln["qty"]
    new_online = open_online = pending = 0
    async for b in tdb.bills.find({"channel": "online", "online.status": {"$nin": [*svc.FINAL, "pending_payment"]}}):
        open_online += 1
        new_online += b["online"]["status"] == "placed"
        pending += max(0, calc.balance(b))
    open_counter = await tdb.bills.count_documents({"channel": {"$ne": "online"}, "status": "open"})
    return {"date": today, "sales": sales, "bills": bills, "avg_bill": sales // bills if bills else 0, "by_mode": by_mode, "by_channel": by_channel,
            "new_online": new_online, "open_online": open_online, "open_counter": open_counter, "to_collect": pending,
            "last7": [{"date": d, "sales": series[d]} for d in days],
            "top_items": [{"name": n, "qty": q} for n, q in sorted(items.items(), key=lambda x: -x[1])[:6]]}


# ------------------------------------------------------------------ customers
@router.get("/customers")
async def customers(q: str = "", tdb: TenantDB = Depends(get_tdb), _: Principal = Depends(require_permission("customers.view"))):
    agg: dict[str, dict] = {}
    async for b in tdb.bills.find({"status": {"$ne": "void"}, "customer.phone": {"$ne": ""}}).sort("created_at", -1).limit(5000):
        ph = b["customer"]["phone"]
        a = agg.setdefault(ph, {"phone": ph, "name": b["customer"].get("name", ""), "orders": 0, "spend": 0,
                                "last_order_at": b["created_at"], "registered": False})
        a["orders"] += 1
        a["spend"] += calc.paid_amount(b) if b["status"] != "open" else 0
        a["name"] = a["name"] or b["customer"].get("name", "")
    async for c in tdb.customers.find({"status": {"$ne": "deleted"}}):
        a = agg.setdefault(c["phone"], {"phone": c["phone"], "name": "", "orders": 0, "spend": 0, "last_order_at": c["created_at"], "registered": True})
        a["registered"] = True
        a["name"] = c.get("name") or a["name"]
    rows = list(agg.values())
    if q.strip():
        s = q.strip().lower()
        rows = [r for r in rows if s in r["phone"] or s in r["name"].lower()]
    return sorted(rows, key=lambda r: (-r["spend"], -r["orders"]))[:300]


# ------------------------------------------------------------------ offers
class CouponIn(BaseModel):
    code: str = Field(min_length=3, max_length=20, pattern=r"^[A-Za-z0-9]+$")
    title: str = Field(default="", max_length=60)
    kind: str = Field(default="pct", pattern="^(pct|amount)$")
    value: float = Field(gt=0, le=10_000_000, description="percent, or paise when kind=amount")
    min_subtotal: int = Field(default=0, ge=0, le=100_000_000)
    max_discount: int | None = Field(default=None, ge=1, le=100_000_000)
    valid_to: str | None = None
    active: bool = True


class CouponPatch(BaseModel):
    title: str | None = None
    value: float | None = Field(default=None, gt=0)
    min_subtotal: int | None = Field(default=None, ge=0)
    max_discount: int | None = None
    valid_to: str | None = None
    active: bool | None = None


def _coupon(c: dict) -> dict:
    return {**{k: v for k, v in c.items() if k not in ("_id", "tenant_id")}, "id": str(c["_id"])}


@router.get("/coupons")
async def list_coupons(tdb: TenantDB = Depends(get_tdb), _: Principal = Depends(require_permission("coupons.view"))):
    return [_coupon(c) async for c in tdb.coupons.find({}).sort("code", 1)]


@router.post("/coupons", status_code=201)
async def create_coupon(body: CouponIn, p: Principal = Depends(require_permission("coupons.edit")), tdb: TenantDB = Depends(get_tdb)):
    d = body.model_dump()
    d["code"] = d["code"].upper()
    if d["kind"] == "pct" and d["value"] > 100:
        raise bad_request("BAD_VALUE", "A percent offer cannot be above 100")
    if await tdb.coupons.find_one({"code": d["code"]}):
        raise ApiError(409, "COUPON_EXISTS", "That code is already used")
    d["created_at"] = datetime.now(UTC).isoformat()
    res = await tdb.coupons.insert_one(d)
    d["_id"] = res.inserted_id
    await audit(tdb, p.email, "coupon.create", d["code"])
    return _coupon(d)


@router.patch("/coupons/{coupon_id}")
async def patch_coupon(coupon_id: str, body: CouponPatch, p: Principal = Depends(require_permission("coupons.edit")), tdb: TenantDB = Depends(get_tdb)):
    upd = body.model_dump(exclude_unset=True)
    if not upd:
        raise bad_request("NOTHING", "Nothing to change")
    c = await tdb.coupons.find_one_and_update({"_id": _oid(coupon_id)}, {"$set": upd}, return_document=True)
    if not c:
        raise not_found("Offer not found")
    await audit(tdb, p.email, "coupon.update", c["code"], upd)
    return _coupon(c)


@router.delete("/coupons/{coupon_id}", status_code=204)
async def delete_coupon(coupon_id: str, p: Principal = Depends(require_permission("coupons.edit")), tdb: TenantDB = Depends(get_tdb)):
    r = await tdb.coupons.delete_one({"_id": _oid(coupon_id)})
    if r.deleted_count != 1:
        raise not_found("Offer not found")
    await audit(tdb, p.email, "coupon.delete", coupon_id)


# ------------------------------------------------------------------ tables
@router.get("/tables")
async def tables(tdb: TenantDB = Depends(get_tdb), p: Principal = Depends(require_permission("bills.view"))):
    names = (p.config.get("pos") or {}).get("tables") or DEFAULT_TABLES
    busy: dict[str, dict] = {}
    async for b in tdb.bills.find({"type": "Dine-in", "status": "open"}):
        if b.get("table"):
            busy[b["table"]] = {"bill_id": str(b["_id"]), "bill_no": b["bill_no"], "total": b["totals"]["total"], "since": b["created_at"]}
    return [{"table": t, "state": "occupied" if t in busy else "free", **({"bill": busy[t]} if t in busy else {})} for t in names]


# ------------------------------------------------------------------ staff
class UserPatch(BaseModel):
    name: str | None = Field(default=None, max_length=60)
    role: str | None = None
    status: str | None = Field(default=None, pattern="^(active|disabled)$")
    phone: str | None = Field(default=None, max_length=15, pattern=r"^\d{0,15}$")


@router.patch("/users/{user_id}")
async def patch_user(user_id: str, body: UserPatch, request: Request, p: Principal = Depends(require_permission("users.manage")),
                     tdb: TenantDB = Depends(get_tdb)):
    u = await tdb.users.find_one({"_id": _oid(user_id)})
    if not u:
        raise not_found("User not found")
    if u["role"] == "owner" and (body.role or body.status):
        raise ApiError(403, "OWNER_PROTECTED", "The owner account cannot be changed this way")
    if str(u["_id"]) == p.user_id and body.status == "disabled":
        raise bad_request("SELF_DISABLE", "You cannot disable your own account")
    upd = body.model_dump(exclude_unset=True)
    if "role" in upd and (upd["role"] not in ROLE_PERMISSIONS or upd["role"] == "owner"):
        raise bad_request("BAD_ROLE", "Unknown or restricted role")
    if upd:
        revoke = "role" in upd or upd.get("status") == "disabled"
        await tdb.users.update_one({"_id": u["_id"]}, {"$set": upd, **({"$inc": {"token_version": 1}} if revoke else {})})
        await audit(tdb, p.email, "user.update", u["email"], upd, client_ip(request))
    return {"id": user_id, "email": u["email"], **{k: upd.get(k, u.get(k)) for k in ("name", "role", "status", "phone")}}


# ------------------------------------------------------------------ menu bulk actions
class BulkAvailIn(BaseModel):
    category: str
    available: bool


class BulkPriceIn(BaseModel):
    category: str | None = None
    pct: float = Field(ge=-50, le=100)


@router.post("/pos/menu/bulk-availability")
async def bulk_avail(body: BulkAvailIn, p: Principal = Depends(require_permission("menu.stock")), tdb: TenantDB = Depends(get_tdb)):
    r = await tdb.menu_items.update_many({"category": body.category}, {"$set": {"available": body.available}})
    await audit(tdb, p.email, "menu.bulk_availability", body.category, {"available": body.available})
    return {"updated": r.modified_count}


@router.post("/pos/menu/bulk-price")
async def bulk_price(body: BulkPriceIn, p: Principal = Depends(require_permission("menu.edit")), tdb: TenantDB = Depends(get_tdb)):
    n = 0
    flt = {"category": body.category} if body.category else {"category": {"$exists": True}}
    async for it in tdb.menu_items.find(flt):
        new = max(100, int(round(int(it["price"]) * (1 + body.pct / 100) / 100.0)) * 100)   # round to a whole rupee, never below ₹1
        await tdb.menu_items.update_one({"_id": it["_id"]}, {"$set": {"price": new}})
        n += 1
    await audit(tdb, p.email, "menu.bulk_price", body.category or "all", {"pct": body.pct, "items": n})
    return {"updated": n}
