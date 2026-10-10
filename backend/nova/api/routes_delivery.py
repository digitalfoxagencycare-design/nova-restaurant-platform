"""Delivery partner API. The partner sees ready orders waiting at the shop, accepts one (first come wins), shares location,
and closes it with the 4-digit code the customer shows. Cash on delivery is collected and recorded at that moment."""
from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from ..core.errors import ApiError, bad_request, not_found
from ..services import online as svc
from ..services import whatsapp as wa_svc
from ..services.audit import audit
from ..services.billing import PAY_MODES, _load
from ..tenancy.db import TenantDB
from .deps import Principal, get_tdb, get_tenant_record, require_permission

router = APIRouter(prefix="/v2/delivery")
PERM = "orders.update.delivery"
MAX_CODE_TRIES = 5


def _iso() -> str:
    return datetime.now(UTC).isoformat()


def _view(b: dict, mine: bool) -> dict:
    o = b["online"]
    return {
        "id": str(b["_id"]), "order_no": b["bill_no"], "status": o["status"], "mine": mine, "placed_at": o["placed_at"],
        "customer": {"name": b["customer"].get("name", ""), "phone": b["customer"]["phone"] if mine else ""},
        "address": o.get("address"), "distance_km": o.get("distance_km"), "notes": o.get("notes", ""),
        "items": [{"name": ln["name"], "qty": ln["qty"], "note": ln.get("note", "")} for ln in b["lines"] if not ln.get("fee")],
        "total": b["totals"]["total"], "collect": max(0, b["totals"]["total"] - sum(p["amount"] for p in b["payments"])) if b["status"] == "open" else 0,
        "payment_method": o["payment_method"], "accepted_at": (o.get("driver") or {}).get("accepted_at"), "delivered_at": o.get("delivered_at"),
    }


@router.get("/orders")
async def orders(tdb: TenantDB = Depends(get_tdb), p: Principal = Depends(require_permission(PERM))):
    pool, active, done = [], [], []
    base = {"channel": "online", "online.type": "delivery"}
    async for b in tdb.bills.find({**base, "online.status": "ready", "online.driver": None}).sort("created_at", 1).limit(50):
        pool.append(_view(b, False))
    live = {"$in": ["ready", "preparing", "out_for_delivery"]}
    async for b in tdb.bills.find({**base, "online.driver.id": p.user_id, "online.status": live}).sort("created_at", 1):
        active.append(_view(b, True))
    async for b in tdb.bills.find({**base, "online.driver.id": p.user_id, "online.status": "delivered"}).sort("created_at", -1).limit(100):
        done.append(_view(b, True))
    return {"pickup": pool, "active": active, "history": done}


@router.post("/orders/{order_id}/accept")
async def accept(order_id: str, request: Request, tdb: TenantDB = Depends(get_tdb), p: Principal = Depends(require_permission(PERM)),
                 t: dict = Depends(get_tenant_record)):
    b = await _load(tdb, order_id)
    o = b.get("online") or {}
    if b.get("channel") != "online" or o.get("type") != "delivery":
        raise not_found("Order not found")
    mine = (o.get("driver") or {}).get("id") == p.user_id
    if o["status"] != "ready" or (o.get("driver") and not mine):
        raise ApiError(409, "TAKEN", "Another partner already took this order")
    me = await tdb.users.find_one({"email": p.email}) or {}
    stamp = _iso()
    # first writer wins: the filter requires the order to still be ready and unassigned at write time
    r = await tdb.bills.update_one(
        {"_id": b["_id"], "online.status": "ready", "$or": [{"online.driver": None}, {"online.driver.id": p.user_id}]},
        {"$set": {"online.driver": {"id": p.user_id, "name": me.get("name") or p.email, "phone": me.get("phone", ""), "accepted_at": stamp}}},
    )
    if r.matched_count != 1:
        raise ApiError(409, "TAKEN", "Another partner already took this order")
    b = await _load(tdb, order_id)
    b = await svc.advance(tdb, p.config, b, "out_for_delivery", p.email, via_driver=True, notify=wa_svc.Notifier(request.app, t))
    return _view(b, True)


class LocationIn(BaseModel):
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    battery: int | None = Field(default=None, ge=0, le=100)
    speed: float | None = Field(default=None, ge=0, le=300, description="km/h")
    online: bool = True


@router.post("/location")
async def location(body: LocationIn, tdb: TenantDB = Depends(get_tdb), p: Principal = Depends(require_permission(PERM))):
    stamp = _iso()
    if body.online and (body.lat is None or body.lng is None):
        raise bad_request("LOCATION_REQUIRED", "Location is needed while you are online")
    if not body.online:
        # going offline needs no position: keep the last known one, just flip the flag
        await tdb.driver_locations.update_one({"driver_id": p.user_id}, {"$set": {"online": False, "driver_id": p.user_id, "updated_at": stamp}}, upsert=True)
        return {"ok": True}
    await tdb.driver_locations.update_one({"driver_id": p.user_id}, {"$set": {**body.model_dump(), "driver_id": p.user_id, "updated_at": stamp}}, upsert=True)
    if body.online:
        await tdb.bills.update_many({"channel": "online", "online.driver.id": p.user_id, "online.status": "out_for_delivery"},
                                    {"$set": {"online.driver_loc": {"lat": body.lat, "lng": body.lng, "at": stamp}}})
    return {"ok": True}


class DeliveredIn(BaseModel):
    code: str = Field(min_length=4, max_length=4)
    collected_mode: str | None = None
    ref: str = ""


@router.post("/orders/{order_id}/delivered")
async def delivered(order_id: str, body: DeliveredIn, request: Request, tdb: TenantDB = Depends(get_tdb),
                    p: Principal = Depends(require_permission(PERM)), t: dict = Depends(get_tenant_record)):
    b = await _load(tdb, order_id)
    o = b.get("online") or {}
    if b.get("channel") != "online" or (o.get("driver") or {}).get("id") != p.user_id:
        raise not_found("Order not found")
    if o["status"] != "out_for_delivery":
        raise ApiError(409, "BAD_TRANSITION", "This order is not out for delivery")
    if o.get("delivery_code_tries", 0) >= MAX_CODE_TRIES:
        raise ApiError(429, "CODE_LOCKED", "Too many wrong codes. Call the restaurant.")
    if not secrets.compare_digest(str(o.get("delivery_code")), body.code):
        await tdb.bills.update_one({"_id": b["_id"]}, {"$inc": {"online.delivery_code_tries": 1}})
        raise ApiError(400, "WRONG_CODE", "That code does not match. Ask the customer to check their app.")
    if body.collected_mode and body.collected_mode not in PAY_MODES:
        raise bad_request("BAD_MODE", "Unknown payment mode")
    collect = {"mode": body.collected_mode, "ref": body.ref} if body.collected_mode else None
    o["delivered_at"] = _iso()
    b["online"] = o
    b = await svc.advance(tdb, p.config, b, "delivered", p.email, collect=collect, via_driver=True, notify=wa_svc.Notifier(request.app, t))
    await audit(tdb, p.email, "delivery.done", str(b["bill_no"]))
    return _view(b, True)


@router.get("/summary")
async def summary(range: str = Query("today", pattern="^(today|7d|30d|all)$"), tdb: TenantDB = Depends(get_tdb),
                  p: Principal = Depends(require_permission(PERM))):
    tz = ZoneInfo(p.config["locale"]["timezone"])
    now = datetime.now(tz)
    since = {"today": now.replace(hour=0, minute=0, second=0, microsecond=0), "7d": now - timedelta(days=7),
             "30d": now - timedelta(days=30), "all": None}[range]
    n = cash = 0
    km_f = 0.0
    async for b in tdb.bills.find({"channel": "online", "online.driver.id": p.user_id, "online.status": "delivered"}):
        at = datetime.fromisoformat(b["online"].get("delivered_at") or b["created_at"])
        if since and at < since:
            continue
        n += 1
        km_f += float(b["online"].get("distance_km") or 0)
        cash += sum(x["amount"] for x in b["payments"] if x["mode"] == "cash")
    pay = (p.config.get("delivery") or {}).get("driver_pay") or {}
    earned = int(round((n * float(pay.get("base", 0)) + km_f * float(pay.get("per_km", 0))) * 100))
    return {"range": range, "deliveries": n, "distance_km": round(km_f, 1), "cash_collected": cash, "earnings": earned, "earnings_configured": bool(pay)}
