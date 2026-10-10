"""WhatsApp through Nova's own business number (Meta Cloud API). One sender for every restaurant: sign-in codes and order updates
all come from the same number. Only approved templates are used (WhatsApp requires them outside a 24 hour chat window).

Settings (phone number id, template names) live in ``platform_settings``; the access token is an encrypted secret. All of it is
entered from the Nova console. Message failures never break an order: they are logged to the restaurant's usage events.
"""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime

import httpx

from ..core.config import Settings
from ..core.errors import ApiError
from ..tenancy.db import PlatformDB, TenantDB
from . import secrets as secrets_svc

log = logging.getLogger("nova.whatsapp")

DEFAULT_TEMPLATES = {
    "otp": {"name": "nova_login_code", "lang": "en"},                # authentication template: "{{1}} is your verification code."
    "order_update": {"name": "nova_order_update", "lang": "en"},     # utility template with 4 variables, see docs/14
}
DEFAULT_VERSION = "v21.0"


class WhatsAppError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code, self.retryable = code, retryable


@dataclass
class WhatsAppConfig:
    phone_number_id: str
    token: str
    api_version: str = DEFAULT_VERSION
    templates: dict = field(default_factory=lambda: dict(DEFAULT_TEMPLATES))


async def load_settings(pdb: PlatformDB) -> dict:
    doc = await pdb.platform_settings.find_one({"key": "whatsapp"}) or {}
    return {"phone_number_id": doc.get("phone_number_id", ""), "waba_id": doc.get("waba_id", ""), "api_version": doc.get("api_version", DEFAULT_VERSION),
            "templates": {**DEFAULT_TEMPLATES, **(doc.get("templates") or {})}, "enabled": bool(doc.get("enabled", True))}


async def load_config(pdb: PlatformDB, s: Settings) -> WhatsAppConfig | None:
    st = await load_settings(pdb)
    if not st["phone_number_id"] or not st["enabled"]:
        return None
    token = await secrets_svc.get(pdb, s, "platform", "whatsapp.access_token")
    if not token:
        return None
    return WhatsAppConfig(st["phone_number_id"], token, st["api_version"], st["templates"])


def e164(phone: str, tenant_cfg: dict) -> str:
    digits = re.sub(r"\D", "", phone or "")
    cc = (tenant_cfg.get("locale") or {}).get("country_code", "91")
    return digits if len(digits) > 10 else cc + digits


class MetaWhatsApp:
    def __init__(self, http: httpx.AsyncClient, base: str, cfg: WhatsAppConfig):
        self.http, self.base, self.cfg = http, base.rstrip("/"), cfg

    async def _post(self, payload: dict) -> dict:
        url = f"{self.base}/{self.cfg.api_version}/{self.cfg.phone_number_id}/messages"
        try:
            r = await self.http.post(url, json={"messaging_product": "whatsapp", **payload}, headers={"Authorization": f"Bearer {self.cfg.token}"}, timeout=10)
        except httpx.HTTPError as e:
            raise WhatsAppError("NETWORK", "Could not reach WhatsApp", retryable=True) from e
        if r.status_code >= 400:
            err = (r.json().get("error") or {}) if r.headers.get("content-type", "").startswith("application/json") else {}
            code = str(err.get("code", r.status_code))
            # 190 = token expired/invalid, 131030 = number not in allowed list (test mode), 132000.. = template/parameter problems
            why = (err.get("error_data") or {}).get("details") or err.get("message") or "WhatsApp refused the message"
            raise WhatsAppError(code, why, retryable=r.status_code >= 500)
        return r.json()

    async def send_template(self, to: str, name: str, lang: str, body: list[str], *, code_button: str | None = None) -> dict:
        comps = [{"type": "body", "parameters": [{"type": "text", "text": str(p)[:1000]} for p in body]}]
        if code_button is not None:      # authentication templates carry the code in a copy-code button too
            comps.append({"type": "button", "sub_type": "url", "index": "0", "parameters": [{"type": "text", "text": code_button}]})
        return await self._post({"to": to, "type": "template", "template": {"name": name, "language": {"code": lang}, "components": comps}})

    async def send_otp(self, to: str, code: str) -> dict:
        t = self.cfg.templates["otp"]
        return await self.send_template(to, t["name"], t["lang"], [code], code_button=code)

    async def send_order_update(self, to: str, brand: str, order_no: str, phrase: str, link: str) -> dict:
        t = self.cfg.templates["order_update"]
        return await self.send_template(to, t["name"], t["lang"], [brand, order_no, phrase, link])


class PlatformOtpSender:
    """The OtpSender the customer API uses when Nova's WhatsApp is connected."""

    def __init__(self, wa: MetaWhatsApp):
        self.wa = wa

    async def send(self, tenant_cfg: dict, phone: str, code: str) -> None:
        try:
            await self.wa.send_otp(e164(phone, tenant_cfg), code)
        except WhatsAppError as e:
            log.warning("otp send failed: %s", e.code)
            raise ApiError(502, "OTP_SEND_FAILED", "We could not send the code on WhatsApp. Please try again in a minute.") from e


async def build(app, pdb: PlatformDB) -> MetaWhatsApp | None:
    cfg = await load_config(pdb, app.state.settings)
    return MetaWhatsApp(app.state.http, app.state.settings.whatsapp_api_base, cfg) if cfg else None


# ------------------------------------------------------------------ order updates
PHRASES = {
    "placed": "received. We will confirm shortly",
    "preparing": "being prepared",
    "served": "served. Enjoy your meal",
    "delivered": "delivered. Enjoy your meal",
    "completed": "completed. Thank you for ordering",
    "cancelled": "cancelled. If you paid online, the refund is on its way",
}


def phrase_for(event: str, bill: dict) -> str | None:
    o = bill["online"]
    if event == "ready":
        return {"delivery": "packed and waiting for a delivery partner", "takeaway": "ready for pickup", "dine-in": "ready"}.get(o["type"], "ready")
    if event == "out_for_delivery":
        return f"on the way. Delivery code: {o.get('delivery_code', '')}"
    return PHRASES.get(event)


class Notifier:
    """Fire-and-forget order messages. A failure is recorded, never raised."""

    def __init__(self, app, tenant: dict):
        self.app, self.tenant = app, tenant

    def order_event(self, tdb: TenantDB, bill: dict, event: str) -> None:
        o = bill.get("online") or {}
        cfg = self.tenant["config"]
        if not o.get("whatsapp_updates", True) or (((cfg.get("integrations") or {}).get("whatsapp")) or {}).get("order_updates") is False:
            return
        text = phrase_for(event, bill)
        if not text or not bill["customer"].get("phone"):
            return
        task = asyncio.create_task(self._send(tdb, bill["customer"]["phone"], str(bill["bill_no"]), text, event))
        tasks = self.app.state.bg_tasks
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    async def _send(self, tdb: TenantDB, phone: str, order_no: str, text: str, event: str) -> None:
        ok, err = False, ""
        try:
            wa = await build(self.app, PlatformDB(self.app.state.database))
            if wa is None:
                return           # WhatsApp is not connected: stay silent, the app still shows live status
            base = self.app.state.settings.public_base_url.rstrip("/")
            link = f"{base}/s/{self.tenant['slug']}" if base else ""
            await wa.send_order_update(e164(phone, self.tenant["config"]), self.tenant["config"]["brand"]["name"], order_no, text, link or "your order page")
            ok = True
        except WhatsAppError as e:
            err = e.code
        except Exception as e:      # noqa: BLE001 - background task: log and move on
            err = type(e).__name__
            log.exception("order message failed")
        await tdb.usage_events.insert_one({"type": "whatsapp", "kind": event, "ok": ok, "error": err, "to_last4": phone[-4:],
                                           "ts": datetime.now(UTC).isoformat()})


async def drain(app) -> None:
    """Wait for queued messages (tests, graceful shutdown)."""
    while app.state.bg_tasks:
        await asyncio.gather(*list(app.state.bg_tasks), return_exceptions=True)
