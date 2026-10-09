"""Login, sessions with refresh rotation + reuse detection, lockout, invites. No seeded passwords anywhere."""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from ..core.config import Settings
from ..core.errors import ApiError, unauthorized
from ..core.security import (
    TokenError,
    check_password_strength,
    decode_token,
    encode_token,
    hash_password,
    random_token,
    sha256,
    verify_password,
)
from ..tenancy.db import PlatformDB, TenantDB


@dataclass(frozen=True)
class Tokens:
    access_token: str
    refresh_token: str
    expires_in: int


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


async def _locked(tdb: TenantDB, s: Settings, email: str) -> bool:
    rec = await tdb.login_attempts.find_one({"email": email})
    if not rec or rec.get("count", 0) < s.max_failed_logins:
        return False
    return datetime.fromisoformat(rec["last"]) + timedelta(minutes=s.lockout_minutes) > _now()


async def _fail(tdb: TenantDB, email: str) -> None:
    await tdb.login_attempts.update_one({"email": email}, {"$inc": {"count": 1}, "$set": {"last": _iso(_now())}}, upsert=True)


async def _clear(tdb: TenantDB, email: str) -> None:
    await tdb.login_attempts.delete_many({"email": email})


async def issue_tokens(tdb: TenantDB, s: Settings, user: dict, family: str | None = None) -> Tokens:
    family = family or uuid.uuid4().hex
    claims = {"sub": str(user["_id"]), "tid": tdb.tenant_id, "role": user["role"], "ver": user.get("token_version", 0), "kind": "tenant"}
    access, _ = encode_token(s, claims, timedelta(minutes=s.access_ttl_minutes), "access")
    refresh, jti = encode_token(s, {**claims, "fam": family}, timedelta(days=s.refresh_ttl_days), "refresh")
    await tdb.sessions.insert_one({
        "jti": jti, "family": family, "user_id": str(user["_id"]), "revoked": False,
        "expires_at": _iso(_now() + timedelta(days=s.refresh_ttl_days)), "created_at": _iso(_now()),
    })
    return Tokens(access, refresh, s.access_ttl_minutes * 60)


async def login(tdb: TenantDB, s: Settings, email: str, password: str) -> Tokens:
    email = email.strip().lower()
    if await _locked(tdb, s, email):
        raise ApiError(429, "ACCOUNT_LOCKED", "Too many failed attempts. Try again later.")
    user = await tdb.users.find_one({"email": email})
    # same error for unknown user / wrong password / inactive: no account enumeration
    if not user or user.get("status") != "active" or not verify_password(password, user.get("password_hash", "")):
        await _fail(tdb, email)
        raise unauthorized("Invalid email or password")
    await _clear(tdb, email)
    return await issue_tokens(tdb, s, user)


async def refresh(tdb: TenantDB, s: Settings, refresh_token: str) -> Tokens:
    try:
        claims = decode_token(s, refresh_token, "refresh")
    except TokenError as e:
        raise unauthorized("Invalid refresh token") from e
    if claims.get("tid") != tdb.tenant_id:
        raise unauthorized("Invalid refresh token")
    sess = await tdb.sessions.find_one({"jti": claims["jti"]})
    if not sess:
        raise unauthorized("Invalid refresh token")
    if sess["revoked"]:
        # a rotated-out token was presented again: assume theft, kill the whole family
        await tdb.sessions.update_many({"family": sess["family"]}, {"$set": {"revoked": True}})
        raise unauthorized("Session revoked")
    user = await _user_by_str_id(tdb, sess["user_id"])
    if not user or user.get("status") != "active" or user.get("token_version", 0) != claims.get("ver", 0):
        raise unauthorized("Session revoked")
    await tdb.sessions.update_one({"jti": sess["jti"]}, {"$set": {"revoked": True}})
    return await issue_tokens(tdb, s, user, family=sess["family"])


async def _user_by_str_id(tdb: TenantDB, uid: str):
    from bson import ObjectId
    from bson.errors import InvalidId
    try:
        return await tdb.users.find_one({"_id": ObjectId(uid)})
    except InvalidId:
        return None


async def logout(tdb: TenantDB, s: Settings, refresh_token: str) -> None:
    try:
        claims = decode_token(s, refresh_token, "refresh")
    except TokenError:
        return
    if claims.get("tid") == tdb.tenant_id:
        await tdb.sessions.update_many({"jti": claims["jti"]}, {"$set": {"revoked": True}})


async def revoke_all_sessions(tdb: TenantDB, user_id: str) -> None:
    await tdb.sessions.update_many({"user_id": user_id}, {"$set": {"revoked": True}})
    from bson import ObjectId
    await tdb.users.update_one({"_id": ObjectId(user_id)}, {"$inc": {"token_version": 1}})


async def create_invite(tdb: TenantDB, s: Settings, email: str, role: str, name: str = "") -> str:
    """Create a pending user + a one-time invite token (returned once; only its hash is stored)."""
    email = email.strip().lower()
    token = random_token()
    await tdb.users.insert_one({
        "email": email, "name": name, "role": role, "status": "invited", "password_hash": "", "token_version": 0,
        "created_at": _iso(_now()),
    })
    await tdb.invites.insert_one({
        "token_hash": sha256(token), "email": email, "used": False,
        "expires_at": _iso(_now() + timedelta(hours=s.invite_ttl_hours)),
    })
    return token


async def accept_invite(tdb: TenantDB, token: str, password: str) -> None:
    inv = await tdb.invites.find_one({"token_hash": sha256(token)})
    if not inv or inv["used"] or datetime.fromisoformat(inv["expires_at"]) < _now():
        raise ApiError(400, "INVITE_INVALID", "This invite link is invalid or has expired")
    try:
        check_password_strength(password)
    except ValueError as e:
        raise ApiError(400, "WEAK_PASSWORD", str(e)) from e
    res = await tdb.users.update_one(
        {"email": inv["email"], "status": "invited"}, {"$set": {"password_hash": hash_password(password), "status": "active"}}
    )
    if res.matched_count != 1:
        raise ApiError(400, "INVITE_INVALID", "This invite link is invalid or has expired")
    await tdb.invites.update_one({"token_hash": inv["token_hash"]}, {"$set": {"used": True}})


# ---- platform (Nova staff) -------------------------------------------------------------------
async def create_platform_admin(pdb: PlatformDB, email: str, password: str, role: str = "platform_admin") -> None:
    await pdb.platform_users.insert_one({
        "email": email.strip().lower(), "role": role, "status": "active", "password_hash": hash_password(password),
        "token_version": 0, "created_at": _iso(_now()),
    })


async def platform_login(pdb: PlatformDB, s: Settings, email: str, password: str) -> Tokens:
    email = email.strip().lower()
    user = await pdb.platform_users.find_one({"email": email})
    if not user or user.get("status") != "active" or not verify_password(password, user["password_hash"]):
        raise unauthorized("Invalid email or password")
    claims = {"sub": str(user["_id"]), "role": user["role"], "ver": user.get("token_version", 0), "kind": "platform"}
    access, _ = encode_token(s, claims, timedelta(minutes=min(s.access_ttl_minutes, 30)), "access")
    return Tokens(access, "", min(s.access_ttl_minutes, 30) * 60)
