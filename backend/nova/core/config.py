"""Process settings. Everything comes from the environment; nothing secret has a default."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: Literal["development", "test", "production"] = "development"
    mongo_url: str = "mongodb://localhost:27017"
    db_name: str = "nova_platform"
    # kid -> secret. No default value on purpose: a missing key must fail loudly.
    jwt_keys: dict[str, str] = Field(default_factory=dict)
    jwt_active_kid: str = ""
    access_ttl_minutes: int = 30
    refresh_ttl_days: int = 14
    allowed_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)
    debug_otp: bool = False
    allow_test_otp: bool = False
    max_failed_logins: int = 5
    lockout_minutes: int = 15
    invite_ttl_hours: int = 72
    # 32 url-safe base64 bytes (Fernet). Encrypts tenant payment keys and the WhatsApp token at rest. Required in production.
    secrets_key: str = ""
    # Public address customers use to open the ordering site (tracking links in WhatsApp messages), e.g. https://order.example.com
    public_base_url: str = ""
    razorpay_api_base: str = "https://api.razorpay.com"
    whatsapp_api_base: str = "https://graph.facebook.com"
    tenant_schema_path: Path = REPO_ROOT / "config" / "tenant.schema.json"

    @field_validator("jwt_keys", mode="before")
    @classmethod
    def _parse_keys(cls, v):
        if isinstance(v, str):
            return json.loads(v) if v.strip() else {}
        return v

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _parse_origins(cls, v):
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def is_production(self) -> bool:
        return self.env == "production"
