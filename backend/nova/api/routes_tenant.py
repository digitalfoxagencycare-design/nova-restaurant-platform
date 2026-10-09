from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, EmailStr

from ..core.config import Settings
from ..core.errors import ApiError
from ..core.permissions import ROLE_PERMISSIONS
from ..services import auth as auth_svc
from ..services import tenants as tenant_svc
from ..services.audit import audit
from ..tenancy.db import PlatformDB, TenantDB
from .deps import Principal, client_ip, get_platform_db, get_settings, get_tdb, get_tenant_record, require_permission

router = APIRouter(prefix="/v2")


class UserInviteIn(BaseModel):
    email: EmailStr
    name: str = ""
    role: str


@router.get("/tenants/me")
async def my_tenant(tenant: dict = Depends(get_tenant_record), _: Principal = Depends(require_permission("config.view"))):
    return {"id": tenant["_id"], "slug": tenant["slug"], "status": tenant["status"], "plan": tenant["plan"],
            "config_version": tenant["config_version"], "config": tenant["config"]}


@router.put("/tenants/me/config")
async def put_config(
    new_cfg: dict[str, Any], request: Request, p: Principal = Depends(require_permission("config.edit")),
    tdb: TenantDB = Depends(get_tdb), pdb: PlatformDB = Depends(get_platform_db), s: Settings = Depends(get_settings),
):
    updated, changed = await tenant_svc.update_config(pdb, s, p.tenant_id, new_cfg)
    await audit(tdb, p.email, "tenant.config.update", p.tenant_id, {"changed_sections": changed}, client_ip(request))
    return {"config_version": updated["config_version"], "changed_sections": changed}


@router.get("/users")
async def list_users(tdb: TenantDB = Depends(get_tdb), _: Principal = Depends(require_permission("users.view"))):
    out = []
    async for u in tdb.users.find({}, {"password_hash": 0}):
        out.append({"id": str(u["_id"]), "email": u["email"], "name": u.get("name", ""), "role": u["role"], "status": u["status"]})
    return out


@router.post("/users", status_code=201)
async def invite_user(
    body: UserInviteIn, request: Request, p: Principal = Depends(require_permission("users.manage")),
    tdb: TenantDB = Depends(get_tdb), s: Settings = Depends(get_settings),
):
    if body.role not in ROLE_PERMISSIONS or body.role == "owner":
        raise ApiError(400, "BAD_ROLE", "Unknown or restricted role")
    if await tdb.users.find_one({"email": body.email.lower()}):
        raise ApiError(409, "USER_EXISTS", "A user with this email already exists")
    token = await auth_svc.create_invite(tdb, s, body.email, body.role, body.name)
    await audit(tdb, p.email, "user.invite", body.email, {"role": body.role}, client_ip(request))
    # In production the token is emailed / sent by WhatsApp; it is returned here so the flow is testable.
    return {"invite_token": token}


@router.get("/audit")
async def audit_log(tdb: TenantDB = Depends(get_tdb), _: Principal = Depends(require_permission("audit.view"))):
    return [{k: v for k, v in d.items() if k not in ("_id", "tenant_id")} async for d in tdb.audit_log.find({}).sort("ts", -1).limit(100)]
