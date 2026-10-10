"""Encrypted secrets at rest (payment keys, the WhatsApp token). Written from the Nova console, never returned.

Fernet (AES-128-CBC + HMAC) with ``SECRETS_KEY``. The API only ever reports whether a secret is set and its last 4 characters.
Scopes: ``platform`` (Nova-wide, e.g. the WhatsApp token) or a tenant id (that restaurant's own keys).
"""
from __future__ import annotations

from datetime import UTC, datetime

from cryptography.fernet import Fernet, InvalidToken

from ..core.config import Settings
from ..core.errors import ApiError
from ..tenancy.db import PlatformDB

# Names the console may write. Anything else is refused, so the store cannot be used as a general key-value dump.
TENANT_SECRETS = ("razorpay.key_id", "razorpay.key_secret", "razorpay.webhook_secret")
PLATFORM_SECRETS = ("whatsapp.access_token",)


def _fernet(s: Settings) -> Fernet:
    if not s.secrets_key:
        raise ApiError(503, "SECRETS_NOT_CONFIGURED", "The server has no SECRETS_KEY, so secrets cannot be stored")
    try:
        return Fernet(s.secrets_key.encode())
    except ValueError as e:
        raise ApiError(503, "SECRETS_NOT_CONFIGURED", "SECRETS_KEY is not a valid Fernet key") from e


async def put(pdb: PlatformDB, s: Settings, scope: str, name: str, value: str, actor: str) -> None:
    allowed = PLATFORM_SECRETS if scope == "platform" else TENANT_SECRETS
    if name not in allowed:
        raise ApiError(400, "UNKNOWN_SECRET", "That secret name is not allowed")
    value = (value or "").strip()
    if not 6 <= len(value) <= 600 or any(c.isspace() for c in value):
        raise ApiError(400, "BAD_SECRET", "The value looks wrong (no spaces, 6 to 600 characters)")
    token = _fernet(s).encrypt(value.encode()).decode()
    await pdb.platform_secrets.update_one(
        {"scope": scope, "name": name},
        {"$set": {"ciphertext": token, "last4": value[-4:], "updated_at": datetime.now(UTC).isoformat(), "updated_by": actor}},
        upsert=True,
    )


async def get(pdb: PlatformDB, s: Settings, scope: str, name: str) -> str | None:
    doc = await pdb.platform_secrets.find_one({"scope": scope, "name": name})
    if not doc:
        return None
    try:
        return _fernet(s).decrypt(doc["ciphertext"].encode()).decode()
    except InvalidToken:
        return None   # key was rotated without re-entering the secret: treat as not set


async def delete(pdb: PlatformDB, scope: str, name: str) -> None:
    await pdb.platform_secrets.delete_one({"scope": scope, "name": name})


async def status(pdb: PlatformDB, scope: str, names: tuple[str, ...]) -> dict[str, dict]:
    """Which secrets are set. Never the value."""
    out = {n: {"set": False} for n in names}
    async for d in pdb.platform_secrets.find({"scope": scope}):
        if d["name"] in out:
            out[d["name"]] = {"set": True, "last4": d["last4"], "updated_at": d["updated_at"], "updated_by": d.get("updated_by", "")}
    return out
