"""Nova console API: the one place the Nova team runs every restaurant (tenant) from.

Onboard a client, set their brand (logo, colours, fonts), contact details and settings, store their payment keys, connect Nova's
WhatsApp number, see usage and health, pause or resume a restaurant, export its data, and work the list of interested restaurants.
Secrets are write-only. Every change is written to the platform audit log.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from bson import Binary, ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, EmailStr, Field

from ..billing import calc
from ..core.config import Settings
from ..core.errors import ApiError, bad_request, not_found
from ..services import auth as auth_svc
from ..services import secrets as secrets_svc
from ..services import tenants as tenant_svc
from ..services import whatsapp as wa_svc
from ..services.audit import platform_audit
from ..tenancy.db import PlatformDB
from .deps import Principal, get_platform_db, get_settings, require_permission, tenant_db_for

router = APIRouter(prefix="/v2/platform")
MAX_LOGO = 400_000
LEAD_STATUSES = ("new", "contacted", "demo", "onboarded", "lost")


def _now() -> str:
    return datetime.now(UTC).isoformat()


async def _tenant(pdb: PlatformDB, tid: str) -> dict:
    t = await pdb.tenants.find_one({"_id": tid})
    if not t:
        raise not_found("Restaurant not found")
    return t


async def _stats(tdb, days: int = 30) -> dict:
    since = (datetime.now(UTC) - timedelta(days=days)).date().isoformat()
    orders = gmv = online_orders = 0
    by_day: dict[str, int] = {}
    last = ""
    async for b in tdb.bills.find({"business_date": {"$gte": since}, "status": {"$in": ["paid", "refunded"]}}):
        net = calc.paid_amount(b)
        orders += 1
        gmv += net
        online_orders += b.get("channel") == "online"
        by_day[b["business_date"]] = by_day.get(b["business_date"], 0) + net
        last = max(last, b["created_at"])
    return {"orders": orders, "online_orders": online_orders, "gmv": gmv, "by_day": by_day, "last_order_at": last}


# ------------------------------------------------------------------ overview + health
@router.get("/overview")
async def overview(
    request: Request,
    pdb: PlatformDB = Depends(get_platform_db),
    s: Settings = Depends(get_settings),
    _: Principal = Depends(require_permission("platform.tenants.view")),
):
    counts = {"active": 0, "suspended": 0}
    orders = gmv = wa_ok = wa_fail = 0
    async for t in pdb.tenants.find({}):
        counts[t["status"]] = counts.get(t["status"], 0) + 1
        tdb = tenant_db_for(request, t["_id"])
        st = await _stats(tdb)
        orders += st["orders"]
        gmv += st["gmv"]
        since = (datetime.now(UTC) - timedelta(days=30)).isoformat()
        async for e in tdb.usage_events.find({"type": "whatsapp", "ts": {"$gte": since}}):
            wa_ok += bool(e["ok"])
            wa_fail += not e["ok"]
    leads_new = await pdb.leads.count_documents({"status": "new"})
    wa = await wa_svc.load_config(pdb, s)
    return {
        "tenants": counts,
        "orders_30d": orders,
        "gmv_30d": gmv,
        "leads_new": leads_new,
        "whatsapp": {"connected": wa is not None, "sent_30d": wa_ok, "failed_30d": wa_fail},
    }


@router.get("/health")
async def health(
    pdb: PlatformDB = Depends(get_platform_db),
    s: Settings = Depends(get_settings),
    _: Principal = Depends(require_permission("platform.tenants.view")),
):
    try:
        await pdb.tenants.count_documents({})  # a cheap read proves the database answers
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False
    wa = await wa_svc.load_config(pdb, s)
    return {"database": db_ok, "secrets_key": bool(s.secrets_key), "public_base_url": s.public_base_url, "whatsapp_connected": wa is not None, "env": s.env}


# ------------------------------------------------------------------ restaurants
@router.get("/tenant-template")
async def template(slug: str = "my-restaurant", name: str = "My Restaurant", _: Principal = Depends(require_permission("platform.tenants.view"))):
    return tenant_svc.default_config(slug, name)


@router.get("/tenants")
async def tenants(request: Request, pdb: PlatformDB = Depends(get_platform_db), _: Principal = Depends(require_permission("platform.tenants.view"))):
    out = []
    async for t in pdb.tenants.find({}).sort("created_at", -1):
        tdb = tenant_db_for(request, t["_id"])
        st = await _stats(tdb)
        owner = await tdb.users.find_one({"role": "owner"}) or {}
        out.append(
            {
                "id": t["_id"],
                "slug": t["slug"],
                "name": t["config"]["brand"]["name"],
                "status": t["status"],
                "plan": t["plan"],
                "created_at": t.get("created_at"),
                "logo_url": t["config"]["brand"].get("logo_url", ""),
                "colors": t["config"]["brand"].get("colors", {}),
                "owner_email": owner.get("email", ""),
                "owner_status": owner.get("status", ""),
                "orders_30d": st["orders"],
                "gmv_30d": st["gmv"],
                "last_order_at": st["last_order_at"],
            }
        )
    return out


@router.get("/tenants/{tid}")
async def tenant_detail(
    tid: str,
    request: Request,
    pdb: PlatformDB = Depends(get_platform_db),
    s: Settings = Depends(get_settings),
    _: Principal = Depends(require_permission("platform.tenants.view")),
):
    t = await _tenant(pdb, tid)
    tdb = tenant_db_for(request, tid)
    cfg = t["config"]
    owner = await tdb.users.find_one({"role": "owner"}) or {}
    st = await _stats(tdb)
    users, menu, customers = await tdb.users.count_documents({}), await tdb.menu_items.count_documents({}), await tdb.customers.count_documents({})
    secret_state = await secrets_svc.status(pdb, tid, secrets_svc.TENANT_SECRETS)
    wa = await wa_svc.load_config(pdb, s)
    base = s.public_base_url.rstrip("/")
    checklist = [
        {"key": "brand", "label": "Logo and colours set", "done": bool(cfg["brand"].get("logo_url")) and bool(cfg["brand"].get("colors"))},
        {"key": "owner", "label": "Owner has accepted the invite", "done": owner.get("status") == "active"},
        {"key": "menu", "label": "Menu has dishes", "done": menu > 0},
        {"key": "delivery", "label": "Shop location set for delivery", "done": bool((cfg.get("delivery") or {}).get("origin"))},
        {
            "key": "payments",
            "label": "Online payment keys added",
            "done": secret_state["razorpay.key_id"]["set"] and secret_state["razorpay.key_secret"]["set"],
        },
        {"key": "whatsapp", "label": "Nova WhatsApp connected", "done": wa is not None},
        {"key": "first_order", "label": "First order received", "done": st["orders"] > 0 or bool(await tdb.bills.count_documents({}))},
    ]
    return {
        "id": tid,
        "slug": t["slug"],
        "status": t["status"],
        "plan": t["plan"],
        "created_at": t.get("created_at"),
        "config": cfg,
        "config_version": t["config_version"],
        "owner": {"email": owner.get("email", ""), "status": owner.get("status", "")},
        "counts": {"users": users, "menu_items": menu, "customers": customers},
        "stats": {k: v for k, v in st.items() if k != "by_day"},
        "secrets": secret_state,
        "checklist": checklist,
        "links": {"storefront": f"{base}/s/{t['slug']}" if base else f"/s/{t['slug']}", "admin": f"{base}/app/" if base else "/app/"},
    }


@router.put("/tenants/{tid}/config")
async def put_config(
    tid: str,
    new_cfg: dict[str, Any],
    pdb: PlatformDB = Depends(get_platform_db),
    s: Settings = Depends(get_settings),
    p: Principal = Depends(require_permission("platform.tenants.edit")),
):
    updated, changed = await tenant_svc.update_config(pdb, s, tid, new_cfg)
    await platform_audit(pdb, p.email, "tenant.config.update", tid, {"changed_sections": changed})
    return {"config_version": updated["config_version"], "changed_sections": changed}


class PlanIn(BaseModel):
    plan: str = Field(pattern="^(starter|growth|pro)$")


@router.put("/tenants/{tid}/plan", status_code=204)
async def set_plan(tid: str, body: PlanIn, pdb: PlatformDB = Depends(get_platform_db), p: Principal = Depends(require_permission("platform.tenants.edit"))):
    r = await pdb.tenants.update_one({"_id": tid}, {"$set": {"plan": body.plan}})
    if r.matched_count != 1:
        raise not_found("Restaurant not found")
    await platform_audit(pdb, p.email, "tenant.plan", tid, {"plan": body.plan})


@router.post("/tenants/{tid}/activate", status_code=204)
async def activate(tid: str, pdb: PlatformDB = Depends(get_platform_db), p: Principal = Depends(require_permission("platform.tenants.suspend"))):
    r = await pdb.tenants.update_one({"_id": tid}, {"$set": {"status": "active"}})
    if r.matched_count != 1:
        raise not_found("Restaurant not found")
    await platform_audit(pdb, p.email, "tenant.activate", tid)


def _image_type(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None  # SVG and anything else is refused: SVG can carry scripts


@router.post("/tenants/{tid}/logo")
async def upload_logo(
    tid: str,
    request: Request,
    pdb: PlatformDB = Depends(get_platform_db),
    s: Settings = Depends(get_settings),
    p: Principal = Depends(require_permission("platform.tenants.edit")),
):
    """Raw image bytes as the request body (PNG, JPEG or WebP, up to 400 KB)."""
    t = await _tenant(pdb, tid)
    data = await request.body()
    if not data or len(data) > MAX_LOGO:
        raise bad_request("BAD_LOGO", "Logo must be an image of at most 400 KB")
    ctype = _image_type(data)
    if not ctype:
        raise bad_request("BAD_LOGO", "Logo must be a PNG, JPEG or WebP image")
    await pdb.assets.update_one(
        {"tenant_id": tid, "kind": "logo"}, {"$set": {"content_type": ctype, "data": Binary(data), "size": len(data), "updated_at": _now()}}, upsert=True
    )
    cfg = {**t["config"], "brand": {**t["config"]["brand"], "logo_url": f"/v2/public/{t['slug']}/logo?v={int(datetime.now(UTC).timestamp())}"}}
    await tenant_svc.update_config(pdb, s, tid, cfg)
    await platform_audit(pdb, p.email, "tenant.logo", tid, {"bytes": len(data)})
    return {"logo_url": cfg["brand"]["logo_url"]}


@router.post("/tenants/{tid}/owner-invite")
async def owner_invite(
    tid: str,
    request: Request,
    pdb: PlatformDB = Depends(get_platform_db),
    s: Settings = Depends(get_settings),
    p: Principal = Depends(require_permission("platform.tenants.edit")),
):
    """New one-time sign-up link for an owner who has not set a password yet. Share it by WhatsApp or e-mail yourself."""
    await _tenant(pdb, tid)
    tdb = tenant_db_for(request, tid)
    owner = await tdb.users.find_one({"role": "owner"})
    if not owner:
        raise not_found("This restaurant has no owner account")
    token = await auth_svc.reissue_invite(tdb, s, owner["email"])
    await platform_audit(pdb, p.email, "tenant.owner_invite", tid)
    return {"invite_token": token, "email": owner["email"], "expires_hours": s.invite_ttl_hours}


# ------------------------------------------------------------------ secrets (write-only)
class SecretIn(BaseModel):
    value: str


@router.get("/tenants/{tid}/secrets")
async def tenant_secrets(tid: str, pdb: PlatformDB = Depends(get_platform_db), _: Principal = Depends(require_permission("platform.secrets.manage"))):
    await _tenant(pdb, tid)
    return await secrets_svc.status(pdb, tid, secrets_svc.TENANT_SECRETS)


@router.put("/tenants/{tid}/secrets/{name}", status_code=204)
async def put_tenant_secret(
    tid: str,
    name: str,
    body: SecretIn,
    pdb: PlatformDB = Depends(get_platform_db),
    s: Settings = Depends(get_settings),
    p: Principal = Depends(require_permission("platform.secrets.manage")),
):
    await _tenant(pdb, tid)
    await secrets_svc.put(pdb, s, tid, name, body.value, p.email)
    await platform_audit(pdb, p.email, "tenant.secret.set", tid, {"name": name})


@router.delete("/tenants/{tid}/secrets/{name}", status_code=204)
async def delete_tenant_secret(
    tid: str, name: str, pdb: PlatformDB = Depends(get_platform_db), p: Principal = Depends(require_permission("platform.secrets.manage"))
):
    if name not in secrets_svc.TENANT_SECRETS:
        raise bad_request("UNKNOWN_SECRET", "That secret name is not allowed")
    await secrets_svc.delete(pdb, tid, name)
    await platform_audit(pdb, p.email, "tenant.secret.delete", tid, {"name": name})


# ------------------------------------------------------------------ usage and export
@router.get("/tenants/{tid}/usage")
async def usage(tid: str, request: Request, pdb: PlatformDB = Depends(get_platform_db), _: Principal = Depends(require_permission("platform.tenants.view"))):
    await _tenant(pdb, tid)
    tdb = tenant_db_for(request, tid)
    st = await _stats(tdb)
    days = [(datetime.now(UTC) - timedelta(days=i)).date().isoformat() for i in range(29, -1, -1)]
    since = (datetime.now(UTC) - timedelta(days=30)).isoformat()
    ok = bad = 0
    async for e in tdb.usage_events.find({"type": "whatsapp", "ts": {"$gte": since}}):
        ok += bool(e["ok"])
        bad += not e["ok"]
    return {
        "orders": st["orders"],
        "online_orders": st["online_orders"],
        "gmv": st["gmv"],
        "last_order_at": st["last_order_at"],
        "daily": [{"date": d, "sales": st["by_day"].get(d, 0)} for d in days],
        "whatsapp": {"sent": ok, "failed": bad},
    }


EXPORT_COLLECTIONS = ("outlets", "users", "customers", "menu_items", "coupons", "bills", "kot_tickets", "audit_log", "usage_events")
EXPORT_CAP = 20000
EXPORT_DROP = {"password_hash", "token_version", "pin_hash", "pin"}


def _plain(v: Any) -> Any:
    if isinstance(v, ObjectId):
        return str(v)
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items() if k not in EXPORT_DROP}
    if isinstance(v, list):
        return [_plain(x) for x in v]
    return v


@router.get("/tenants/{tid}/export")
async def export(tid: str, request: Request, pdb: PlatformDB = Depends(get_platform_db), p: Principal = Depends(require_permission("platform.tenants.edit"))):
    """All of a restaurant's records as JSON (for hand-over or off-boarding). No passwords, PINs or payment keys."""
    t = await _tenant(pdb, tid)
    tdb = tenant_db_for(request, tid)
    data: dict[str, Any] = {"exported_at": _now(), "restaurant": {"slug": t["slug"], "plan": t["plan"], "config": t["config"]}, "truncated": []}
    for name in EXPORT_COLLECTIONS:
        rows = [_plain(d) async for d in getattr(tdb, name).find({}).limit(EXPORT_CAP + 1)]
        if len(rows) > EXPORT_CAP:
            rows = rows[:EXPORT_CAP]
            data["truncated"].append(name)
        data[name] = rows
    await platform_audit(pdb, p.email, "tenant.export", tid)
    return json.loads(json.dumps(data, default=str))


# ------------------------------------------------------------------ WhatsApp connection (Nova's own number)
class WaSettingsIn(BaseModel):
    phone_number_id: str = Field(pattern=r"^\d{6,20}$")
    waba_id: str = Field(default="", pattern=r"^\d{0,20}$")
    api_version: str = Field(default=wa_svc.DEFAULT_VERSION, pattern=r"^v\d{1,2}\.\d$")
    enabled: bool = True
    templates: dict[str, dict[str, str]] | None = None


@router.get("/settings/whatsapp")
async def get_wa(pdb: PlatformDB = Depends(get_platform_db), _: Principal = Depends(require_permission("platform.settings.manage"))):
    st = await wa_svc.load_settings(pdb)
    token = (await secrets_svc.status(pdb, "platform", secrets_svc.PLATFORM_SECRETS))["whatsapp.access_token"]
    return {**st, "token": token, "connected": bool(st["phone_number_id"] and token["set"] and st["enabled"])}


@router.put("/settings/whatsapp")
async def put_wa(body: WaSettingsIn, pdb: PlatformDB = Depends(get_platform_db), p: Principal = Depends(require_permission("platform.settings.manage"))):
    tpl = {}
    for k, v in (body.templates or {}).items():
        if k not in wa_svc.DEFAULT_TEMPLATES or not (set(v) <= {"name", "lang"}) or not v.get("name", "x").replace("_", "").isalnum():
            raise bad_request("BAD_TEMPLATE", "Templates are otp and order_update, each with a name and a language")
        tpl[k] = {**wa_svc.DEFAULT_TEMPLATES[k], **v}
    doc = {
        "phone_number_id": body.phone_number_id,
        "waba_id": body.waba_id,
        "api_version": body.api_version,
        "enabled": body.enabled,
        **({"templates": tpl} if tpl else {}),
    }
    await pdb.platform_settings.update_one({"key": "whatsapp"}, {"$set": {"key": "whatsapp", **doc}}, upsert=True)
    await platform_audit(pdb, p.email, "settings.whatsapp", "platform", {k: v for k, v in doc.items()})
    return await wa_svc.load_settings(pdb)


@router.put("/settings/whatsapp/token", status_code=204)
async def put_wa_token(
    body: SecretIn,
    pdb: PlatformDB = Depends(get_platform_db),
    s: Settings = Depends(get_settings),
    p: Principal = Depends(require_permission("platform.secrets.manage")),
):
    await secrets_svc.put(pdb, s, "platform", "whatsapp.access_token", body.value, p.email)
    await platform_audit(pdb, p.email, "settings.whatsapp.token", "platform")


class WaTestIn(BaseModel):
    to: str = Field(pattern=r"^\d{10,15}$", description="phone with country code, digits only")
    kind: str = Field(default="order_update", pattern="^(otp|order_update)$")


@router.post("/settings/whatsapp/test")
async def test_wa(
    body: WaTestIn, request: Request, pdb: PlatformDB = Depends(get_platform_db), p: Principal = Depends(require_permission("platform.settings.manage"))
):
    """Send one real message with the chosen template so you can see it arrive on a phone."""
    wa = await wa_svc.build(request.app, pdb)
    if wa is None:
        raise ApiError(409, "WHATSAPP_NOT_CONNECTED", "Add the phone number id and the access token first")
    try:
        res = await (
            wa.send_otp(body.to, "123456")
            if body.kind == "otp"
            else wa.send_order_update(body.to, "Nova test", "0000", "a test message", "https://nova.example")
        )
    except wa_svc.WhatsAppError as e:
        raise ApiError(502, "WHATSAPP_REFUSED", f"WhatsApp refused it ({e.code}): {e}") from e
    await platform_audit(pdb, p.email, "settings.whatsapp.test", "platform", {"kind": body.kind})
    return {"sent": True, "message_id": ((res.get("messages") or [{}])[0]).get("id", "")}


# ------------------------------------------------------------------ interested restaurants
@router.get("/leads")
async def leads(status: str | None = None, pdb: PlatformDB = Depends(get_platform_db), _: Principal = Depends(require_permission("platform.leads.manage"))):
    flt = {"status": status} if status in LEAD_STATUSES else {}
    return [
        {**{k: v for k, v in d.items() if k not in ("_id", "ip_hash")}, "id": str(d["_id"])}
        async for d in pdb.leads.find(flt).sort("created_at", -1).limit(300)
    ]


class LeadPatch(BaseModel):
    status: str | None = Field(default=None, pattern="^(new|contacted|demo|onboarded|lost)$")
    note: str | None = Field(default=None, max_length=500)


@router.patch("/leads/{lead_id}")
async def patch_lead(
    lead_id: str, body: LeadPatch, pdb: PlatformDB = Depends(get_platform_db), p: Principal = Depends(require_permission("platform.leads.manage"))
):
    try:
        oid = ObjectId(lead_id)
    except (InvalidId, TypeError) as e:
        raise not_found("Not found") from e
    upd: dict[str, Any] = {}
    if body.status:
        upd["$set"] = {"status": body.status}
    if body.note:
        upd["$push"] = {"notes": {"text": body.note, "by": p.email, "at": _now()}}
    if not upd:
        raise bad_request("NOTHING", "Nothing to change")
    d = await pdb.leads.find_one_and_update({"_id": oid}, upd, return_document=True)
    if not d:
        raise not_found("Not found")
    return {**{k: v for k, v in d.items() if k not in ("_id", "ip_hash")}, "id": str(d["_id"])}


@router.get("/audit")
async def audit_log(
    limit: int = Query(100, ge=1, le=300), pdb: PlatformDB = Depends(get_platform_db), _: Principal = Depends(require_permission("platform.tenants.view"))
):
    return [{k: v for k, v in d.items() if k != "_id"} async for d in pdb.platform_audit.find({}).sort("ts", -1).limit(limit)]


class OwnerEmail(BaseModel):
    email: EmailStr
