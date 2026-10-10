"""Online payment with Razorpay. Each restaurant uses ITS OWN Razorpay account (money goes straight to the restaurant); the keys are
entered in the Nova console and stored encrypted. The server creates the Razorpay order for the exact bill total, the customer pays in
Razorpay's checkout, and the payment is confirmed by signature (browser/app callback) or by webhook, whichever arrives first. Both paths
are idempotent. Refunds on cancellation go back through the same account.
"""
from __future__ import annotations

import hashlib
import hmac
from datetime import UTC, datetime

import httpx

from ..core.config import Settings
from ..core.errors import ApiError
from ..tenancy.db import PlatformDB
from . import secrets as secrets_svc

CHECKOUT_MINUTES = 20


class RazorpayKeys:
    def __init__(self, key_id: str, key_secret: str, webhook_secret: str | None):
        self.key_id, self.key_secret, self.webhook_secret = key_id, key_secret, webhook_secret


async def load_keys(pdb: PlatformDB, s: Settings, tenant_id: str) -> RazorpayKeys | None:
    kid = await secrets_svc.get(pdb, s, tenant_id, "razorpay.key_id")
    sec = await secrets_svc.get(pdb, s, tenant_id, "razorpay.key_secret")
    if not kid or not sec:
        return None
    return RazorpayKeys(kid, sec, await secrets_svc.get(pdb, s, tenant_id, "razorpay.webhook_secret"))


def wants_online(cfg: dict) -> bool:
    return "razorpay" in ((cfg.get("payments") or {}).get("methods") or [])


async def available(pdb: PlatformDB, s: Settings, tenant: dict) -> bool:
    return wants_online(tenant["config"]) and await load_keys(pdb, s, tenant["_id"]) is not None


def sign(order_id: str, payment_id: str, secret: str) -> str:
    return hmac.new(secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


def signature_ok(order_id: str, payment_id: str, signature: str, secret: str) -> bool:
    return bool(signature) and hmac.compare_digest(sign(order_id, payment_id, secret), signature)


def webhook_ok(body: bytes, signature: str, secret: str) -> bool:
    return bool(signature and secret) and hmac.compare_digest(hmac.new(secret.encode(), body, hashlib.sha256).hexdigest(), signature)


class Razorpay:
    def __init__(self, http: httpx.AsyncClient, base: str, keys: RazorpayKeys):
        self.http, self.base, self.keys = http, base.rstrip("/"), keys

    async def _call(self, path: str, payload: dict) -> dict:
        try:
            r = await self.http.post(f"{self.base}{path}", json=payload, auth=(self.keys.key_id, self.keys.key_secret), timeout=12)
        except httpx.HTTPError as e:
            raise ApiError(502, "PAYMENT_PROVIDER_DOWN", "The payment service did not answer. Please try again.") from e
        if r.status_code >= 400:
            try:
                msg = (r.json().get("error") or {}).get("description", "")
            except ValueError:
                msg = ""
            raise ApiError(502, "PAYMENT_PROVIDER_ERROR", msg or "The payment service refused the request")
        return r.json()

    async def create_order(self, amount: int, receipt: str, notes: dict) -> dict:
        return await self._call("/v1/orders", {"amount": amount, "currency": "INR", "receipt": receipt[:40], "notes": notes})

    async def refund(self, payment_id: str, amount: int, notes: dict) -> dict:
        return await self._call(f"/v1/payments/{payment_id}/refund", {"amount": amount, "notes": notes})


async def razorpay_for(app, tenant_id: str) -> Razorpay | None:
    keys = await load_keys(PlatformDB(app.state.database), app.state.settings, tenant_id)
    return Razorpay(app.state.http, app.state.settings.razorpay_api_base, keys) if keys else None


def now() -> str:
    return datetime.now(UTC).isoformat()


class Checkout:
    """What place_order needs to start an online payment for one bill."""

    def __init__(self, rzp: Razorpay, tenant: dict):
        self.rzp, self.tenant = rzp, tenant

    async def begin(self, bill: dict) -> dict:
        amount = bill["totals"]["total"]
        order = await self.rzp.create_order(amount, f"B{bill['bill_no']}", {"restaurant": self.tenant["slug"], "bill_no": str(bill["bill_no"])})
        return {"provider": "razorpay", "order_id": order["id"], "key_id": self.rzp.keys.key_id, "amount": amount, "status": "created"}


def refunder(rzp: Razorpay, tenant: dict):
    async def go(payment_id: str, amount: int) -> dict:
        try:
            return await rzp.refund(payment_id, amount, {"restaurant": tenant["slug"], "why": "order cancelled"})
        except ApiError as e:
            raise ApiError(502, "REFUND_FAILED", "The refund could not be sent to the payment service, so the order was not cancelled. Try again.") from e
    return go
