"""Customer-facing API: storefront, menu, quote, sign-in by phone code, orders. Tenant comes from the URL slug for public
calls and from the signed customer token afterwards (never from a header or body)."""

from __future__ import annotations

from dataclasses import dataclass

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from ..core.config import Settings
from ..core.errors import ApiError, not_found, unauthorized
from ..services import customers as cust_svc
from ..services import online as svc
from ..services import payments as pay_svc
from ..services import tenants as tenant_svc
from ..services import whatsapp as wa_svc
from ..services.billing import _load
from ..tenancy.db import PlatformDB, TenantDB
from .deps import bearer, get_platform_db, get_settings, tenant_db_for

router = APIRouter(prefix="/v2")


@dataclass
class CustomerCtx:
    customer: dict
    tdb: TenantDB
    cfg: dict
    tenant: dict


async def _tenant(pdb: PlatformDB, slug: str) -> dict:
    t = await tenant_svc.get_by_slug(pdb, slug)
    if not t or t.get("status") != "active":
        raise not_found("Restaurant not found")
    return t


async def get_customer(
    request: Request,
    cred: HTTPAuthorizationCredentials | None = Depends(bearer),
    s: Settings = Depends(get_settings),
    pdb: PlatformDB = Depends(get_platform_db),
) -> CustomerCtx:
    if cred is None:
        raise unauthorized()
    claims = cust_svc.read_customer_token(s, cred.credentials)
    t = await pdb.tenants.find_one({"_id": claims.get("tid")})
    if not t or t.get("status") != "active":
        raise unauthorized("Restaurant is not active")
    tdb = tenant_db_for(request, t["_id"])
    try:
        c = await tdb.customers.find_one({"_id": ObjectId(claims["sub"])})
    except InvalidId:
        c = None
    if not c or c.get("status") == "blocked" or c.get("token_version", 0) != claims.get("ver", 0):
        raise unauthorized("Session ended. Sign in again.")
    return CustomerCtx(c, tdb, t["config"], t)


class OtpSendIn(BaseModel):
    phone: str


class OtpVerifyIn(BaseModel):
    phone: str
    code: str = Field(min_length=4, max_length=8)
    name: str = ""


class CartLine(BaseModel):
    item_id: str
    qty: int = 1
    note: str = ""


class AddressIn(BaseModel):
    text: str = ""
    landmark: str = ""
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


class QuoteIn(BaseModel):
    type: str
    items: list[CartLine]
    table: str | None = None
    address: AddressIn | None = None
    coupon: str = ""


class OrderIn(QuoteIn):
    payment: str = "cod"  # "cod" (pay on delivery / at the counter) or "online"
    notes: str = ""
    name: str = ""
    whatsapp_updates: bool = True


class PaymentConfirmIn(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, max_length=60)
    addresses: list[AddressIn] | None = Field(default=None, max_length=10)


def _body(m: BaseModel) -> dict:
    return m.model_dump()


# ------------------------------------------------------------------ public
@router.get("/public/{slug}/storefront")
async def storefront(slug: str, pdb: PlatformDB = Depends(get_platform_db), s: Settings = Depends(get_settings)):
    t = await _tenant(pdb, slug)
    out = svc.storefront(t)
    out["payments"]["online"] = await pay_svc.available(pdb, s, t)
    return out


@router.get("/public/{slug}/menu")
async def menu(slug: str, request: Request, pdb: PlatformDB = Depends(get_platform_db)):
    t = await _tenant(pdb, slug)
    return await svc.public_menu(tenant_db_for(request, t["_id"]))


@router.post("/public/{slug}/quote")
async def quote(slug: str, body: QuoteIn, request: Request, pdb: PlatformDB = Depends(get_platform_db)):
    t = await _tenant(pdb, slug)
    return svc.quote_view(await svc.price_cart(tenant_db_for(request, t["_id"]), t["config"], _body(body)))


@router.post("/public/{slug}/otp/send")
async def otp_send(slug: str, body: OtpSendIn, request: Request, pdb: PlatformDB = Depends(get_platform_db), s: Settings = Depends(get_settings)):
    t = await _tenant(pdb, slug)
    sender = getattr(request.app.state, "otp_sender", None)
    if sender is None:
        wa = await wa_svc.build(request.app, pdb)
        sender = wa_svc.PlatformOtpSender(wa) if wa else None
    return await cust_svc.send_otp(tenant_db_for(request, t["_id"]), s, sender, t["config"], body.phone)


@router.post("/public/{slug}/otp/verify")
async def otp_verify(slug: str, body: OtpVerifyIn, request: Request, pdb: PlatformDB = Depends(get_platform_db), s: Settings = Depends(get_settings)):
    t = await _tenant(pdb, slug)
    cust, token, is_new = await cust_svc.verify_otp(tenant_db_for(request, t["_id"]), s, t["config"], body.phone, body.code, body.name)
    return {"access_token": token, "token_type": "bearer", "is_new": is_new, "customer": _me(cust)}


# ------------------------------------------------------------------ signed-in customer
def _me(c: dict) -> dict:
    return {"id": str(c["_id"]), "phone": c["phone"], "name": c.get("name", ""), "addresses": c.get("addresses", [])}


@router.get("/me")
async def me(ctx: CustomerCtx = Depends(get_customer)):
    return _me(ctx.customer)


@router.put("/me")
async def update_me(body: ProfileIn, ctx: CustomerCtx = Depends(get_customer)):
    upd = {}
    if body.name is not None:
        upd["name"] = body.name.strip()
    if body.addresses is not None:
        upd["addresses"] = [a.model_dump() for a in body.addresses]
    if upd:
        await ctx.tdb.customers.update_one({"_id": ctx.customer["_id"]}, {"$set": upd})
        ctx.customer.update(upd)
    return _me(ctx.customer)


@router.delete("/me", status_code=204)
async def delete_me(ctx: CustomerCtx = Depends(get_customer)):
    """Account deletion (a store requirement). Order history stays for the restaurant's tax records, detached from the profile."""
    await ctx.tdb.customers.update_one({"_id": ctx.customer["_id"]}, {"$set": {"name": "", "addresses": [], "status": "deleted"}, "$inc": {"token_version": 1}})


@router.post("/me/quote")
async def me_quote(body: QuoteIn, ctx: CustomerCtx = Depends(get_customer)):
    return svc.quote_view(await svc.price_cart(ctx.tdb, ctx.cfg, _body(body)))


@router.post("/me/orders", status_code=201)
async def place(body: OrderIn, request: Request, ctx: CustomerCtx = Depends(get_customer), idem: str | None = Header(default=None, alias="Idempotency-Key")):
    checkout = None
    if body.payment == "online" and pay_svc.wants_online(ctx.cfg):
        rzp = await pay_svc.razorpay_for(request.app, ctx.tenant["_id"])
        checkout = pay_svc.Checkout(rzp, ctx.tenant) if rzp else None
    b = await svc.place_order(ctx.tdb, ctx.cfg, ctx.customer, _body(body), idem, pay=checkout, notify=wa_svc.Notifier(request.app, ctx.tenant))
    return svc.customer_view(b)


@router.post("/me/orders/{order_id}/payment")
async def confirm_payment(
    order_id: str,
    body: PaymentConfirmIn,
    request: Request,
    ctx: CustomerCtx = Depends(get_customer),
    pdb: PlatformDB = Depends(get_platform_db),
    s: Settings = Depends(get_settings),
):
    """The checkout reported success. Trust nothing but the signature, made with the restaurant's secret key."""
    b = await _mine(ctx, order_id)
    o = b["online"]
    pay = o.get("payment") or {}
    keys = await pay_svc.load_keys(pdb, s, ctx.tenant["_id"])
    if not keys or o["payment_method"] != "online" or pay.get("order_id") != body.razorpay_order_id:
        raise ApiError(400, "PAYMENT_MISMATCH", "This payment does not belong to this order")
    if not pay_svc.signature_ok(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature, keys.key_secret):
        raise ApiError(400, "PAYMENT_SIGNATURE", "The payment could not be verified")
    b = await svc.confirm_online_payment(ctx.tdb, ctx.cfg, b, body.razorpay_payment_id, "razorpay", notify=wa_svc.Notifier(request.app, ctx.tenant))
    return svc.customer_view(b)


@router.get("/me/orders")
async def my_orders(ctx: CustomerCtx = Depends(get_customer)):
    await svc.expire_pending(ctx.tdb, ctx.cfg)
    out = []
    async for b in ctx.tdb.bills.find({"channel": "online", "online.customer_id": str(ctx.customer["_id"])}).sort("created_at", -1).limit(50):
        out.append(svc.customer_view(b))
    return out


async def _mine(ctx: CustomerCtx, order_id: str) -> dict:
    b = await _load(ctx.tdb, order_id)
    if b.get("channel") != "online" or b["online"]["customer_id"] != str(ctx.customer["_id"]):
        raise not_found("Order not found")
    return b


@router.get("/me/orders/{order_id}")
async def my_order(order_id: str, ctx: CustomerCtx = Depends(get_customer)):
    await svc.expire_pending(ctx.tdb, ctx.cfg)
    return svc.customer_view(await _mine(ctx, order_id))


@router.post("/me/orders/{order_id}/cancel")
async def cancel_mine(order_id: str, request: Request, ctx: CustomerCtx = Depends(get_customer)):
    b = await _mine(ctx, order_id)
    if b["online"]["status"] not in ("placed", "pending_payment"):
        raise ApiError(409, "TOO_LATE", "The kitchen has already started. Please call the restaurant to cancel.")
    rzp = await pay_svc.razorpay_for(request.app, ctx.tenant["_id"]) if b["payments"] else None
    b = await svc.advance(
        ctx.tdb,
        ctx.cfg,
        b,
        "cancelled",
        f"customer:{ctx.customer['phone']}",
        reason="Cancelled by customer",
        notify=wa_svc.Notifier(request.app, ctx.tenant),
        refunder=pay_svc.refunder(rzp, ctx.tenant) if rzp else None,
    )
    return svc.customer_view(b)
