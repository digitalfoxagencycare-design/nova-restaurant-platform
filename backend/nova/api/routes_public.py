from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, EmailStr

from ..core.config import Settings
from ..core.errors import ApiError, unauthorized
from ..services import auth as auth_svc
from ..services import tenants as tenant_svc
from ..services.audit import audit
from ..tenancy.db import PlatformDB
from .deps import client_ip, get_platform_db, get_settings, tenant_db_for

router = APIRouter(prefix="/v2")


class LoginIn(BaseModel):
    tenant: str
    email: EmailStr
    password: str


class RefreshIn(BaseModel):
    tenant: str
    refresh_token: str


class InviteAcceptIn(BaseModel):
    tenant: str
    token: str
    password: str


async def _tenant_or_401(pdb: PlatformDB, slug: str) -> dict:
    t = await tenant_svc.get_by_slug(pdb, slug)
    # same response for unknown and suspended tenants
    if not t or t.get("status") != "active":
        raise unauthorized("Invalid credentials")
    return t


@router.get("/health")
async def health(settings: Settings = Depends(get_settings)):
    return {"status": "ok", "env": settings.env}


@router.post("/auth/login")
async def login(body: LoginIn, request: Request, pdb: PlatformDB = Depends(get_platform_db), s: Settings = Depends(get_settings)):
    t = await _tenant_or_401(pdb, body.tenant)
    tdb = tenant_db_for(request, t["_id"])
    tokens = await auth_svc.login(tdb, s, body.email, body.password)
    await audit(tdb, body.email, "auth.login", ip=client_ip(request))
    return {"access_token": tokens.access_token, "refresh_token": tokens.refresh_token, "expires_in": tokens.expires_in, "token_type": "bearer"}


@router.post("/auth/refresh")
async def refresh(body: RefreshIn, request: Request, pdb: PlatformDB = Depends(get_platform_db), s: Settings = Depends(get_settings)):
    t = await _tenant_or_401(pdb, body.tenant)
    tokens = await auth_svc.refresh(tenant_db_for(request, t["_id"]), s, body.refresh_token)
    return {"access_token": tokens.access_token, "refresh_token": tokens.refresh_token, "expires_in": tokens.expires_in, "token_type": "bearer"}


@router.post("/auth/logout", status_code=204)
async def logout(body: RefreshIn, request: Request, pdb: PlatformDB = Depends(get_platform_db), s: Settings = Depends(get_settings)):
    t = await tenant_svc.get_by_slug(pdb, body.tenant)
    if t:
        await auth_svc.logout(tenant_db_for(request, t["_id"]), s, body.refresh_token)


@router.post("/auth/accept-invite", status_code=204)
async def accept_invite(body: InviteAcceptIn, request: Request, pdb: PlatformDB = Depends(get_platform_db)):
    t = await tenant_svc.get_by_slug(pdb, body.tenant)
    if not t or t.get("status") != "active":
        raise ApiError(400, "INVITE_INVALID", "This invite link is invalid or has expired")
    await auth_svc.accept_invite(tenant_db_for(request, t["_id"]), body.token, body.password)
