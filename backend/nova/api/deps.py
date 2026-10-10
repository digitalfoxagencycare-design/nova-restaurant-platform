"""Request-scoped dependencies. Route modules get a TenantDB / PlatformDB only from here."""
from __future__ import annotations

from dataclasses import dataclass

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..core.config import Settings
from ..core.errors import forbidden, unauthorized
from ..core.permissions import effective_permissions, has_permission, permissions_for
from ..core.security import TokenError, decode_token
from ..tenancy.db import PlatformDB, TenantDB

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Principal:
    kind: str                  # "tenant" | "platform"
    user_id: str
    role: str
    email: str
    tenant_id: str | None
    permissions: frozenset[str]
    config: dict | None = None


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_platform_db(request: Request) -> PlatformDB:
    return PlatformDB(request.app.state.database)


def tenant_db_for(request: Request, tenant_id: str) -> TenantDB:
    return TenantDB(request.app.state.database, tenant_id)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


async def _load_user(coll, uid: str):
    try:
        return await coll.find_one({"_id": ObjectId(uid)})
    except InvalidId:
        return None


async def get_principal(
    request: Request,
    cred: HTTPAuthorizationCredentials | None = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> Principal:
    """Identity comes ONLY from the signed token. Headers/query/body can never choose a tenant."""
    if cred is None:
        raise unauthorized()
    try:
        claims = decode_token(settings, cred.credentials, "access")
    except TokenError as e:
        raise unauthorized(str(e)) from e
    if claims.get("kind") == "customer":
        raise unauthorized("Not a staff token")
    pdb = PlatformDB(request.app.state.database)
    if claims.get("kind") == "platform":
        user = await _load_user(pdb.platform_users, claims["sub"])
        if not user or user.get("status") != "active" or user.get("token_version", 0) != claims.get("ver", 0):
            raise unauthorized("Session revoked")
        return Principal("platform", str(user["_id"]), user["role"], user["email"], None, permissions_for(user["role"], platform=True))
    tid = claims.get("tid")
    tenant = await pdb.tenants.find_one({"_id": tid}) if tid else None
    if not tenant or tenant.get("status") != "active":
        raise unauthorized("Tenant is not active")
    tdb = TenantDB(request.app.state.database, tid)
    user = await _load_user(tdb.users, claims["sub"])
    if not user or user.get("status") != "active" or user.get("token_version", 0) != claims.get("ver", 0):
        raise unauthorized("Session revoked")
    cfg = tenant.get("config") or {}
    return Principal("tenant", str(user["_id"]), user["role"], user["email"], tid, effective_permissions(user["role"], cfg), cfg)


async def require_tenant_principal(p: Principal = Depends(get_principal)) -> Principal:
    if p.kind != "tenant" or not p.tenant_id:
        raise forbidden("This endpoint is for restaurant users")
    return p


async def require_platform_principal(p: Principal = Depends(get_principal)) -> Principal:
    if p.kind != "platform":
        raise forbidden("Nova platform access required")
    return p


def require_permission(needed: str):
    async def checker(p: Principal = Depends(get_principal)) -> Principal:
        # Namespaces never cross: a restaurant owner's "*" must not satisfy platform.* and vice versa.
        if needed.startswith("platform.") != (p.kind == "platform"):
            raise forbidden("Not allowed for this account type")
        if not has_permission(p.permissions, needed):
            raise forbidden(f"Missing permission: {needed}")
        return p
    return checker


async def get_tdb(request: Request, p: Principal = Depends(require_tenant_principal)) -> TenantDB:
    return TenantDB(request.app.state.database, p.tenant_id)


async def get_tenant_record(request: Request, p: Principal = Depends(require_tenant_principal)) -> dict:
    return await PlatformDB(request.app.state.database).tenants.find_one({"_id": p.tenant_id})
