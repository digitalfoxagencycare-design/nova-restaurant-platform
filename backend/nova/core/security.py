"""Password hashing and signed tokens with key rotation (kid)."""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt

from .config import Settings

ALG = "HS256"
MIN_PASSWORD_LEN = 10


class WeakPassword(ValueError):
    pass


def check_password_strength(p: str) -> None:
    if len(p) < MIN_PASSWORD_LEN:
        raise WeakPassword(f"Password must be at least {MIN_PASSWORD_LEN} characters")
    if p.lower() in {"password123", "1234567890", "qwertyuiop"} or len(set(p)) < 4:
        raise WeakPassword("Password is too easy to guess")


def hash_password(p: str) -> str:
    check_password_strength(p)
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except ValueError:
        return False


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def random_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def _now() -> datetime:
    return datetime.now(UTC)


def encode_token(s: Settings, claims: dict[str, Any], ttl: timedelta, typ: str) -> tuple[str, str]:
    """Return (token, jti). Always stamps iat/exp/typ/jti and the signing kid."""
    jti = uuid.uuid4().hex
    now = _now()
    payload = {**claims, "typ": typ, "jti": jti, "iat": now, "exp": now + ttl}
    token = jwt.encode(payload, s.jwt_keys[s.jwt_active_kid], algorithm=ALG, headers={"kid": s.jwt_active_kid})
    return token, jti


class TokenError(Exception):
    pass


def decode_token(s: Settings, token: str, expected_typ: str) -> dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)
        key = s.jwt_keys.get(header.get("kid", ""))
        if not key:
            raise TokenError("unknown key id")
        if header.get("alg") != ALG:
            raise TokenError("unexpected algorithm")
        payload = jwt.decode(token, key, algorithms=[ALG], options={"require": ["exp", "iat", "jti", "typ"]})
    except jwt.ExpiredSignatureError as e:
        raise TokenError("token expired") from e
    except jwt.PyJWTError as e:
        raise TokenError("invalid token") from e
    if payload.get("typ") != expected_typ:
        raise TokenError("wrong token type")
    return payload
