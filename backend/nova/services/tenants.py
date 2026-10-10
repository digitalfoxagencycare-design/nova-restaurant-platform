from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from typing import Any

from pymongo.errors import DuplicateKeyError

from ..core.config import Settings
from ..core.errors import ApiError
from ..tenancy.config_validation import InvalidTenantConfig, validate_tenant_config
from ..tenancy.db import PlatformDB, TenantDB
from . import auth

SLUG = re.compile(r"^[a-z0-9-]{3,40}$")


def _now() -> str:
    return datetime.now(UTC).isoformat()


async def create_tenant(pdb: PlatformDB, tdb_for, s: Settings, config: dict[str, Any], owner_email: str, plan: str = "starter") -> tuple[dict, str]:
    """Create a tenant and its owner invite. Returns (tenant, invite_token). No default credentials exist."""
    slug = config.get("slug", "")
    if not SLUG.match(slug):
        raise ApiError(400, "BAD_SLUG", "slug must be 3-40 chars of a-z, 0-9, -")
    try:
        validate_tenant_config(config, s.tenant_schema_path)
    except InvalidTenantConfig as e:
        raise ApiError(400, "INVALID_CONFIG", "; ".join(e.errors)) from e
    tid = uuid.uuid4().hex
    doc = {"_id": tid, "slug": slug, "status": "active", "plan": plan, "config": config, "config_version": 1, "created_at": _now()}
    try:
        await pdb.tenants.insert_one(doc)
    except DuplicateKeyError as e:
        raise ApiError(409, "SLUG_TAKEN", "That slug is already in use") from e
    tdb: TenantDB = tdb_for(tid)
    token = await auth.create_invite(tdb, s, owner_email, "owner")
    return doc, token


async def get_by_slug(pdb: PlatformDB, slug: str) -> dict | None:
    return await pdb.tenants.find_one({"slug": slug.strip().lower()})


async def get_by_id(pdb: PlatformDB, tid: str) -> dict | None:
    return await pdb.tenants.find_one({"_id": tid})


async def update_config(pdb: PlatformDB, s: Settings, tid: str, new_cfg: dict[str, Any]) -> tuple[dict, list[str]]:
    cur = await get_by_id(pdb, tid)
    if not cur:
        raise ApiError(404, "NOT_FOUND", "Tenant not found")
    if new_cfg.get("slug") != cur["slug"]:
        raise ApiError(400, "SLUG_IMMUTABLE", "slug cannot be changed here")
    try:
        validate_tenant_config(new_cfg, s.tenant_schema_path)
    except InvalidTenantConfig as e:
        raise ApiError(400, "INVALID_CONFIG", "; ".join(e.errors)) from e
    changed = sorted(k for k in set(cur["config"]) | set(new_cfg) if cur["config"].get(k) != new_cfg.get(k))
    res = await pdb.tenants.find_one_and_update(
        {"_id": tid, "config_version": cur["config_version"]},  # optimistic lock
        {"$set": {"config": new_cfg}, "$inc": {"config_version": 1}},
        return_document=True,
    )
    if not res:
        raise ApiError(409, "CONFIG_CONFLICT", "Configuration changed meanwhile; reload and retry")
    return res, changed


def default_config(slug: str, name: str) -> dict[str, Any]:
    """Sensible starting point for a new restaurant. The console form fills in the rest; everything stays editable."""
    return {
        "slug": slug,
        "brand": {
            "name": name,
            "tagline": "",
            "colors": {"primary": "#EF4B2B", "secondary": "#133B40", "background": "#F5F7F7", "foreground": "#10201F", "muted": "#E4EAEA"},
            "fonts": {"heading": "Bricolage Grotesque", "body": "Figtree"},
            "support": {},
        },
        "locale": {"currency": "INR", "timezone": "Asia/Kolkata", "country_code": "91", "phone_regex": "^[6-9]\\d{9}$", "languages": ["en"]},
        "tax": {"mode": "inclusive", "default_rate": 0.05},
        "operations": {"business_day_start": "04:00", "stations": ["kitchen"]},
        "ordering": {"channels": ["dine-in", "takeaway", "delivery"], "min_order": 0, "prep_minutes": 25},
        "delivery": {"max_km": 5, "free_above": 499, "fee_slabs": [{"up_to_km": 2, "fee": 20}, {"up_to_km": 3, "fee": 30}, {"up_to_km": 5, "fee": 50}]},
        "payments": {"methods": ["cash", "card", "upi", "cod"], "cod": {"enabled": True}},
        "loyalty": {"enabled": False},
        "integrations": {},
    }
