"""Refuse to start in production with unsafe configuration (see docs/08-security-findings.md S3, S4, S8, S11)."""
from __future__ import annotations

from .config import Settings

KNOWN_WEAK_FRAGMENTS = ("supersecret", "changeme", "change_me", "replace_with", "password", "secret123", "example", "dev-key")
MIN_SECRET_LEN = 32


class UnsafeConfiguration(RuntimeError):
    pass


def check_settings(s: Settings) -> list[str]:
    """Return a list of problems. Empty list means safe."""
    problems: list[str] = []
    if not s.jwt_keys:
        problems.append("JWT_KEYS is empty: at least one signing key is required")
    if s.jwt_active_kid not in s.jwt_keys:
        problems.append("JWT_ACTIVE_KID does not name a key in JWT_KEYS")
    for kid, secret in s.jwt_keys.items():
        if len(secret) < MIN_SECRET_LEN:
            problems.append(f"JWT key '{kid}' is shorter than {MIN_SECRET_LEN} characters")
        low = secret.lower()
        if any(f in low for f in KNOWN_WEAK_FRAGMENTS):
            problems.append(f"JWT key '{kid}' looks like a placeholder/default value")
    if s.is_production:
        if s.debug_otp:
            problems.append("DEBUG_OTP must be false in production (it would leak OTP codes)")
        if s.allow_test_otp:
            problems.append("ALLOW_TEST_OTP must be false in production (it accepts a fixed code)")
        if not s.allowed_origins:
            problems.append("ALLOWED_ORIGINS must list explicit origins in production")
        if "*" in s.allowed_origins:
            problems.append("ALLOWED_ORIGINS must not contain '*' in production")
        if any(o.startswith("http://") and "localhost" not in o for o in s.allowed_origins):
            problems.append("ALLOWED_ORIGINS must use https in production")
        if "localhost" in s.mongo_url or "127.0.0.1" in s.mongo_url:
            problems.append("MONGO_URL points at localhost in production")
        if not s.secrets_key:
            problems.append("SECRETS_KEY is required in production (encrypts payment keys and the WhatsApp token)")
        if not s.public_base_url.startswith("https://"):
            problems.append("PUBLIC_BASE_URL must be an https address in production (used in order tracking links)")
        if s.access_ttl_minutes > 60:
            problems.append("ACCESS_TTL_MINUTES must be <= 60 in production")
    return problems


def assert_safe_startup(s: Settings) -> None:
    """Production: raise on any problem. Other envs: raise only on missing/weak signing keys."""
    problems = check_settings(s)
    if not s.is_production:
        problems = [p for p in problems if "JWT" in p and "placeholder" not in p and "shorter" not in p]
    if problems:
        raise UnsafeConfiguration("Refusing to start:\n - " + "\n - ".join(problems))
