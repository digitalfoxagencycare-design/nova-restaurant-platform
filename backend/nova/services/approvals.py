"""Manager approval at the counter: a cashier asks, a manager types a PIN, the cashier's one action goes through.

The PIN is only ever checked against users who hold the needed permission, the resulting token is short-lived, tied to
the requester, the permission and (when known) the bill, and works exactly once. Wrong PINs are rate-limited per requester.
"""
from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

import bcrypt
from pymongo.errors import DuplicateKeyError

from ..api.deps import Principal
from ..core.config import Settings
from ..core.errors import ApiError, bad_request, forbidden
from ..core.permissions import POS_PERMISSIONS, effective_permissions, has_permission
from ..core.security import TokenError, decode_token, encode_token, verify_password
from ..tenancy.db import TenantDB
from .audit import audit

PIN_RE = re.compile(r"^\d{4,6}$")
APPROVAL_TTL = timedelta(seconds=120)
MAX_PIN_FAILS = 5
PIN_LOCK_MIN = 10
WEAK = {"0000", "1111", "1234", "4321", "123456", "000000", "111111", "654321"}


def _now() -> datetime:
    return datetime.now(UTC)


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()


def verify_pin(pin: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pin.encode(), h.encode())
    except ValueError:
        return False


async def set_pin(tdb: TenantDB, p: Principal, pin: str, password: str) -> None:
    if not PIN_RE.match(pin) or pin in WEAK or len(set(pin)) < 3:
        raise bad_request("WEAK_PIN", "Use 4 to 6 digits that are not easy to guess")
    from bson import ObjectId
    user = await tdb.users.find_one({"_id": ObjectId(p.user_id)})
    if not user or not verify_password(password, user["password_hash"]):
        raise forbidden("Password is not correct")
    await tdb.users.update_one({"_id": user["_id"]}, {"$set": {"pin_hash": hash_pin(pin)}})
    await audit(tdb, p.email, "user.pin.set", p.email)


async def _locked(tdb: TenantDB, key: str) -> bool:
    rec = await tdb.login_attempts.find_one({"email": key})
    return bool(rec and rec.get("count", 0) >= MAX_PIN_FAILS and datetime.fromisoformat(rec["last"]) + timedelta(minutes=PIN_LOCK_MIN) > _now())


async def issue(tdb: TenantDB, s: Settings, p: Principal, pin: str, permission: str, bill_id: str = "") -> dict:
    if permission not in POS_PERMISSIONS:
        raise bad_request("BAD_PERMISSION", "That action cannot be approved with a PIN")
    key = f"pin:{p.email}"
    if await _locked(tdb, key):
        raise ApiError(429, "PIN_LOCKED", "Too many wrong PINs. Try again in a few minutes.")
    approver = None
    async for u in tdb.users.find({"status": "active", "pin_hash": {"$exists": True}}):
        if str(u["_id"]) == p.user_id:
            continue
        if has_permission(effective_permissions(u["role"], p.config), permission) and verify_pin(pin, u["pin_hash"]):
            approver = u
            break
    if not approver:
        await tdb.login_attempts.update_one({"email": key}, {"$inc": {"count": 1}, "$set": {"last": _now().isoformat()}}, upsert=True)
        await audit(tdb, p.email, "approval.denied", permission, {"bill": bill_id})
        raise forbidden("That PIN does not belong to someone who can approve this")
    await tdb.login_attempts.delete_many({"email": key})
    claims = {"sub": str(approver["_id"]), "req": p.user_id, "tid": tdb.tenant_id, "perm": permission, "bill": bill_id}
    token, _ = encode_token(s, claims, APPROVAL_TTL, "approval")
    await audit(tdb, approver["email"], "approval.grant", permission, {"for": p.email, "bill": bill_id})
    return {"approval_token": token, "approved_by": approver["name"] or approver["email"], "expires_in": int(APPROVAL_TTL.total_seconds())}


async def consume(tdb: TenantDB, s: Settings, token: str, needed: str, p: Principal, bill_id: str) -> str:
    """Validate and burn an approval. Returns the approver's email for the audit trail."""
    try:
        c = decode_token(s, token, "approval")
    except TokenError as e:
        raise ApiError(403, "APPROVAL_INVALID", "That approval expired. Ask the manager again.") from e
    if c.get("tid") != tdb.tenant_id or c.get("req") != p.user_id or c.get("perm") != needed or (c.get("bill") and bill_id and c["bill"] != bill_id):
        raise ApiError(403, "APPROVAL_INVALID", "That approval is for a different action")
    from bson import ObjectId
    approver = await tdb.users.find_one({"_id": ObjectId(c["sub"])})
    if not approver or approver.get("status") != "active" or not has_permission(effective_permissions(approver["role"], p.config), needed):
        raise ApiError(403, "APPROVAL_INVALID", "The approver can no longer approve this")
    try:
        await tdb.approvals.insert_one({"jti": c["jti"], "used_at": _now().isoformat()})
    except DuplicateKeyError as e:
        raise ApiError(403, "APPROVAL_USED", "That approval was already used") from e
    return approver["email"]
