"""Public endpoints that are not tied to a signed-in person: restaurant logo, enquiry form, payment provider webhook."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from ..core.config import Settings
from ..core.errors import ApiError, not_found
from ..services import online as svc
from ..services import payments as pay_svc
from ..services import whatsapp as wa_svc
from ..services.billing import _save
from ..tenancy.db import PlatformDB
from .deps import client_ip, get_platform_db, get_settings, tenant_db_for

router = APIRouter(prefix="/v2")
LEADS_PER_HOUR = 5


@router.get("/public/{slug}/logo")
async def logo(slug: str, pdb: PlatformDB = Depends(get_platform_db)):
    t = await pdb.tenants.find_one({"slug": slug.strip().lower(), "status": "active"})
    a = await pdb.assets.find_one({"tenant_id": t["_id"], "kind": "logo"}) if t else None
    if not a:
        raise not_found("No logo")
    return Response(
        bytes(a["data"]),
        media_type=a["content_type"],
        headers={"Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox"},
    )


class LeadIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    restaurant: str = Field(min_length=2, max_length=100)
    phone: str = Field(pattern=r"^[0-9+ \-]{10,16}$")
    city: str = Field(default="", max_length=60)
    email: str = Field(default="", max_length=120)
    message: str = Field(default="", max_length=600)
    website: str = ""  # honeypot: real people never see or fill this field


@router.post("/public/leads", status_code=201)
async def create_lead(body: LeadIn, request: Request, pdb: PlatformDB = Depends(get_platform_db)):
    if body.website:
        return {"ok": True}  # a bot filled the hidden field: pretend it worked, store nothing
    ip_hash = hashlib.sha256(f"{client_ip(request)}|{datetime.now(UTC).date()}".encode()).hexdigest()[:24]
    since = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    if await pdb.leads.count_documents({"ip_hash": ip_hash, "created_at": {"$gte": since}}) >= LEADS_PER_HOUR:
        raise ApiError(429, "TOO_MANY", "Too many requests. Please try again later.")
    await pdb.leads.insert_one(
        {**body.model_dump(exclude={"website"}), "status": "new", "notes": [], "ip_hash": ip_hash, "created_at": datetime.now(UTC).isoformat()}
    )
    return {"ok": True}


@router.post("/webhooks/razorpay/{slug}")
async def razorpay_webhook(slug: str, request: Request, pdb: PlatformDB = Depends(get_platform_db), s: Settings = Depends(get_settings)):
    """Payment events from the restaurant's Razorpay account. Authentic only if the signature matches its webhook secret."""
    t = await pdb.tenants.find_one({"slug": slug.strip().lower()})
    if not t:
        raise not_found("Not found")
    keys = await pay_svc.load_keys(pdb, s, t["_id"])
    raw = await request.body()
    if not keys or not keys.webhook_secret or not pay_svc.webhook_ok(raw, request.headers.get("x-razorpay-signature", ""), keys.webhook_secret):
        raise ApiError(400, "BAD_SIGNATURE", "Signature does not match")
    try:
        event = json.loads(raw)
        if event.get("event") not in ("payment.captured", "order.paid"):
            return {"ok": True, "ignored": True}
        pay = event["payload"]["payment"]["entity"]
        order_id, payment_id, amount = pay["order_id"], pay["id"], int(pay["amount"])
    except (ValueError, KeyError, TypeError) as e:
        raise ApiError(400, "BAD_EVENT", "Unreadable event") from e
    tdb = tenant_db_for(request, t["_id"])
    b = await tdb.bills.find_one({"channel": "online", "online.payment.order_id": order_id})
    if not b or amount != b["totals"]["total"]:
        return {"ok": True, "ignored": True}  # not ours, or the amount does not match what we asked for
    notify = wa_svc.Notifier(request.app, t)
    if b["online"]["status"] == "pending_payment":
        await svc.confirm_online_payment(tdb, t["config"], b, payment_id, "razorpay-webhook", notify=notify)
    elif b["status"] == "void" and not b["payments"] and not b["refunds"]:
        # the customer paid after we had cancelled the unpaid order: give the money straight back
        rzp = await pay_svc.razorpay_for(request.app, t["_id"])
        if rzp:
            res = await rzp.refund(payment_id, amount, {"restaurant": t["slug"], "why": "paid after the order expired"})
            b["refunds"].append(
                {
                    "id": payment_id[-8:],
                    "amount": amount,
                    "mode": "online",
                    "reason": "Paid after the order expired",
                    "by": "system",
                    "at": pay_svc.now(),
                    "payment_ref": payment_id,
                    "ref": res.get("id", ""),
                }
            )
            b["payments"].append(
                {
                    "id": payment_id[-8:],
                    "mode": "online",
                    "amount": amount,
                    "tendered": amount,
                    "change": 0,
                    "ref": payment_id,
                    "at": pay_svc.now(),
                    "by": "razorpay-webhook",
                }
            )
            await _save(tdb, b, t["config"], None)
    return {"ok": True}
