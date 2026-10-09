from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, EmailStr

from ..core.config import Settings
from ..core.errors import ApiError
from ..services import auth as auth_svc
from ..services import tenants as tenant_svc
from ..services.audit import platform_audit
from ..tenancy.db import PlatformDB
from .deps import Principal, get_platform_db, get_settings, require_permission, tenant_db_for

router = APIRouter(prefix="/v2/platform")


class PlatformLoginIn(BaseModel):
    email: EmailStr
    password: str


class TenantCreateIn(BaseModel):
    config: dict[str, Any]
    owner_email: EmailStr
    plan: str = "starter"


@router.post("/auth/login")
async def platform_login(body: PlatformLoginIn, pdb: PlatformDB = Depends(get_platform_db), s: Settings = Depends(get_settings)):
    tokens = await auth_svc.platform_login(pdb, s, body.email, body.password)
    return {"access_token": tokens.access_token, "expires_in": tokens.expires_in, "token_type": "bearer"}


@router.post("/tenants", status_code=201)
async def create_tenant(
    body: TenantCreateIn, request: Request, p: Principal = Depends(require_permission("platform.tenants.create")),
    pdb: PlatformDB = Depends(get_platform_db), s: Settings = Depends(get_settings),
):
    tenant, token = await tenant_svc.create_tenant(pdb, lambda tid: tenant_db_for(request, tid), s, body.config, body.owner_email, body.plan)
    await platform_audit(pdb, p.email, "tenant.create", tenant["_id"], {"slug": tenant["slug"]})
    return {"id": tenant["_id"], "slug": tenant["slug"], "owner_invite_token": token}


@router.get("/tenants")
async def list_tenants(pdb: PlatformDB = Depends(get_platform_db), p: Principal = Depends(require_permission("platform.tenants.view"))):
    return [{"id": t["_id"], "slug": t["slug"], "status": t["status"], "plan": t["plan"]} async for t in pdb.tenants.find({})]


@router.post("/tenants/{tenant_id}/suspend", status_code=204)
async def suspend(tenant_id: str, pdb: PlatformDB = Depends(get_platform_db), p: Principal = Depends(require_permission("platform.tenants.suspend"))):
    res = await pdb.tenants.update_one({"_id": tenant_id}, {"$set": {"status": "suspended"}})
    if res.matched_count != 1:
        raise ApiError(404, "NOT_FOUND", "Tenant not found")
    await platform_audit(pdb, p.email, "tenant.suspend", tenant_id)
