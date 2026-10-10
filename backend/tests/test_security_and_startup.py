from datetime import timedelta

import jwt
import pytest
from cryptography.fernet import Fernet

from nova.core.config import Settings
from nova.core.security import (
    TokenError,
    WeakPassword,
    check_password_strength,
    decode_token,
    encode_token,
    hash_password,
    verify_password,
)
from nova.core.startup_checks import UnsafeConfiguration, assert_safe_startup, check_settings
from tests.conftest import make_settings

STRONG = "x" * 10 + "Y9"


def prod(**kw):
    base = dict(env="production", mongo_url="mongodb+srv://u:p@cluster.example.net/db", allowed_origins=["https://app.nova.example"],
                secrets_key=Fernet.generate_key().decode(), public_base_url="https://order.nova.example")
    base.update(kw)
    return make_settings(**base)


def test_password_hash_roundtrip_and_strength():
    h = hash_password("Correct-Horse-9")
    assert verify_password("Correct-Horse-9", h) and not verify_password("nope", h)
    assert not verify_password("x", "not-a-hash")
    for weak in ("short", "aaaaaaaaaaaa", "password123"):
        with pytest.raises(WeakPassword):
            check_password_strength(weak)


def test_token_roundtrip_and_type_confusion():
    s = make_settings()
    tok, _ = encode_token(s, {"sub": "u"}, timedelta(minutes=5), "access")
    assert decode_token(s, tok, "access")["sub"] == "u"
    with pytest.raises(TokenError):
        decode_token(s, tok, "refresh")


def test_expired_tampered_and_unknown_kid():
    s = make_settings()
    old, _ = encode_token(s, {"sub": "u"}, timedelta(seconds=-5), "access")
    with pytest.raises(TokenError):
        decode_token(s, old, "access")
    tok, _ = encode_token(s, {"sub": "u", "tid": "A"}, timedelta(minutes=5), "access")
    head, body, sig = tok.split(".")
    with pytest.raises(TokenError):
        decode_token(s, f"{head}.{body[:-2]}xx.{sig}", "access")
    other = make_settings()  # different random keys, same kid names
    with pytest.raises(TokenError):
        decode_token(other, tok, "access")
    forged = jwt.encode({"sub": "u", "typ": "access", "jti": "1", "iat": 1, "exp": 9999999999}, "k", algorithm="HS256", headers={"kid": "zzz"})
    with pytest.raises(TokenError):
        decode_token(s, forged, "access")


def test_alg_none_rejected():
    s = make_settings()
    forged = jwt.encode({"sub": "u", "typ": "access", "jti": "1", "iat": 1, "exp": 9999999999}, None, algorithm="none", headers={"kid": "k1"})
    with pytest.raises(TokenError):
        decode_token(s, forged, "access")


def test_key_rotation_old_tokens_still_valid_new_signed_with_active():
    s1 = make_settings(jwt_keys={"k1": "a" * 48, "k2": "b" * 48}, jwt_active_kid="k1")
    old, _ = encode_token(s1, {"sub": "u"}, timedelta(minutes=5), "access")
    s2 = make_settings(jwt_keys=s1.jwt_keys, jwt_active_kid="k2")
    assert decode_token(s2, old, "access")["sub"] == "u"
    new, _ = encode_token(s2, {"sub": "u"}, timedelta(minutes=5), "access")
    assert jwt.get_unverified_header(new)["kid"] == "k2"


def test_good_production_settings_pass():
    assert check_settings(prod()) == []
    assert_safe_startup(prod())


@pytest.mark.parametrize("kw,needle", [
    (dict(jwt_keys={}), "JWT_KEYS is empty"),
    (dict(jwt_active_kid="nope"), "JWT_ACTIVE_KID"),
    (dict(jwt_keys={"k1": "short"}), "shorter"),
    (dict(jwt_keys={"k1": "supersecretjwtkeyreplaceinproduction" + "9" * 10}), "placeholder"),
    (dict(debug_otp=True), "DEBUG_OTP"),
    (dict(allow_test_otp=True), "ALLOW_TEST_OTP"),
    (dict(allowed_origins=[]), "ALLOWED_ORIGINS must list"),
    (dict(allowed_origins=["*"]), "'*'"),
    (dict(allowed_origins=["http://evil.example"]), "https"),
    (dict(mongo_url="mongodb://localhost:27017"), "localhost"),
    (dict(access_ttl_minutes=60 * 24 * 30), "ACCESS_TTL"),
])
def test_unsafe_production_settings_refuse_to_start(kw, needle):
    s = prod(**kw)
    assert any(needle in p for p in check_settings(s)), check_settings(s)
    with pytest.raises(UnsafeConfiguration):
        assert_safe_startup(s)


def test_non_production_only_requires_signing_keys():
    assert_safe_startup(make_settings(debug_otp=True))  # allowed in test/dev
    with pytest.raises(UnsafeConfiguration):
        assert_safe_startup(make_settings(jwt_keys={}))


def test_settings_parse_env_strings(monkeypatch):
    monkeypatch.setenv("JWT_KEYS", '{"a":"' + "z" * 40 + '"}')
    monkeypatch.setenv("JWT_ACTIVE_KID", "a")
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example, https://b.example")
    s = Settings()
    assert s.jwt_keys["a"].startswith("z") and s.allowed_origins == ["https://a.example", "https://b.example"]


def test_production_needs_a_secrets_key_and_an_https_public_address():
    problems = check_settings(prod(secrets_key="", public_base_url="http://order.nova.example"))
    assert any("SECRETS_KEY" in p for p in problems) and any("PUBLIC_BASE_URL" in p for p in problems)
