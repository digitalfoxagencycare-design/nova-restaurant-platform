"""Customer identity for the ordering apps: phone + one-time code, no passwords.

* The code is 6 digits, stored only as a hash, valid 5 minutes, 5 tries, and at most 5 codes per phone per hour.
* Delivering the code (WhatsApp/SMS) is a pluggable ``OtpSender`` held on ``app.state.otp_sender``. Without one, a
  production server refuses to send (503) instead of pretending. With ``debug_otp`` on (dev/test only, blocked in
  production by startup_checks) the code is returned in the response so the flow can be tested.
* A customer token is a signed access token with ``kind=customer``. Staff endpoints reject it (deps.get_principal).
"""
from __future__ import annotations

import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Protocol

from ..core.config import Settings
from ..core.errors import ApiError, unauthorized
from ..core.security import TokenError, decode_token, encode_token, sha256
from ..tenancy.db import TenantDB

OTP_TTL_MIN = 5
OTP_TRIES = 5
OTP_PER_HOUR = 5
CUSTOMER_TOKEN_DAYS = 30


class OtpSender(Protocol):
    async def send(self, tenant_cfg: dict, phone: str, code: str) -> None: ...


def _now() -> datetime:
    return datetime.now(UTC)


def normalize_phone(raw: str, cfg: dict) -> str:
    """Digits only; keeps the last 10 for India-style numbers. Raises if it does not match the tenant's phone regex."""
    digits = re.sub(r"\D", "", raw or "")
    cc = cfg["locale"].get("country_code", "91")
    if cc and digits.startswith(cc) and len(digits) > 10:
        digits = digits[len(cc):]
    if not re.match(cfg["locale"].get("phone_regex", r"^\d{10}$"), digits):
        raise ApiError(400, "BAD_PHONE", "Enter a valid mobile number")
    return digits


async def send_otp(tdb: TenantDB, s: Settings, sender: OtpSender | None, cfg: dict, phone_raw: str) -> dict:
    phone = normalize_phone(phone_raw, cfg)
    since = (_now() - timedelta(hours=1)).isoformat()
    if await tdb.otp_verifications.count_documents({"phone": phone, "created_at": {"$gte": since}}) >= OTP_PER_HOUR:
        raise ApiError(429, "OTP_LIMIT", "Too many codes requested. Try again in an hour.")
    if sender is None and not s.debug_otp:
        raise ApiError(503, "OTP_NOT_CONFIGURED", "Sign-in codes are not set up for this restaurant yet")
    code = f"{secrets.randbelow(10**6):06d}"
    await tdb.otp_verifications.insert_one({
        "phone": phone, "code_hash": sha256(f"{tdb.tenant_id}:{phone}:{code}"), "tries": 0, "used": False,
        "created_at": _now().isoformat(), "expires_at": (_now() + timedelta(minutes=OTP_TTL_MIN)).isoformat(),
    })
    if sender is not None:
        await sender.send(cfg, phone, code)
    out = {"sent": True, "expires_in": OTP_TTL_MIN * 60}
    if s.debug_otp:
        out["debug_otp"] = code
    return out


async def verify_otp(tdb: TenantDB, s: Settings, cfg: dict, phone_raw: str, code: str, name: str = "") -> tuple[dict, str, bool]:
    """Returns (customer, access_token, is_new)."""
    phone = normalize_phone(phone_raw, cfg)
    rec = await tdb.otp_verifications.find_one({"phone": phone, "used": False}, sort=[("created_at", -1)])
    if not rec or rec["expires_at"] < _now().isoformat():
        raise ApiError(400, "OTP_INVALID", "That code is wrong or has expired")
    if rec["tries"] >= OTP_TRIES:
        raise ApiError(429, "OTP_LOCKED", "Too many wrong tries. Ask for a new code.")
    if not secrets.compare_digest(rec["code_hash"], sha256(f"{tdb.tenant_id}:{phone}:{(code or '').strip()}")):
        await tdb.otp_verifications.update_one({"_id": rec["_id"]}, {"$inc": {"tries": 1}})
        raise ApiError(400, "OTP_INVALID", "That code is wrong or has expired")
    await tdb.otp_verifications.update_one({"_id": rec["_id"]}, {"$set": {"used": True}})
    cust = await tdb.customers.find_one({"phone": phone})
    is_new = cust is None
    if is_new:
        cust = {"phone": phone, "name": (name or "").strip()[:60], "created_at": _now().isoformat(), "token_version": 0, "addresses": [], "status": "active"}
        res = await tdb.customers.insert_one(cust)
        cust["_id"] = res.inserted_id
    elif cust.get("status") == "blocked":
        raise ApiError(403, "BLOCKED", "This number cannot place orders")
    elif cust.get("status") == "deleted":
        # signing in again after deleting the account starts a fresh, empty profile
        cust.update({"status": "active", "name": (name or "").strip()[:60], "addresses": []})
        await tdb.customers.update_one({"_id": cust["_id"]}, {"$set": {"status": "active", "name": cust["name"], "addresses": []}})
    elif name and not cust.get("name"):
        await tdb.customers.update_one({"_id": cust["_id"]}, {"$set": {"name": name.strip()[:60]}})
        cust["name"] = name.strip()[:60]
    return cust, issue_customer_token(s, tdb.tenant_id, cust), is_new


def issue_customer_token(s: Settings, tenant_id: str, cust: dict) -> str:
    claims = {"sub": str(cust["_id"]), "tid": tenant_id, "kind": "customer", "ver": cust.get("token_version", 0)}
    token, _ = encode_token(s, claims, timedelta(days=CUSTOMER_TOKEN_DAYS), "access")
    return token


def read_customer_token(s: Settings, token: str) -> dict:
    try:
        claims = decode_token(s, token, "access")
    except TokenError as e:
        raise unauthorized(str(e)) from e
    if claims.get("kind") != "customer":
        raise unauthorized("Not a customer token")
    return claims
