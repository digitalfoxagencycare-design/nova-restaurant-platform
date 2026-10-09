import copy
import json
import secrets

import httpx
import pytest
import pytest_asyncio
from mongomock_motor import AsyncMongoMockClient

from nova.app import create_app
from nova.core.config import REPO_ROOT, Settings
from nova.services.auth import create_platform_admin
from nova.tenancy.db import PlatformDB, TenantDB, ensure_indexes

EXAMPLE = json.loads((REPO_ROOT / "config" / "tenants" / "hyderabadi-irani.example.json").read_text())
PW = "Correct-Horse-9"


def make_settings(**kw) -> Settings:
    base = dict(env="test", jwt_keys={"k1": secrets.token_urlsafe(48), "k0": secrets.token_urlsafe(48)}, jwt_active_kid="k1",
                allowed_origins=["http://localhost:3000"], db_name="t")
    base.update(kw)
    return Settings(**base)


def tenant_cfg(slug: str, name: str = "Test") -> dict:
    c = copy.deepcopy(EXAMPLE)
    c["slug"] = slug
    c["brand"]["name"] = name
    c["integrations"]["razorpay"]["secret_ref"] = f"secrets/{slug}/razorpay"
    return c


@pytest.fixture
def settings():
    return make_settings()


@pytest_asyncio.fixture
async def database():
    db = AsyncMongoMockClient()["t"]
    await ensure_indexes(db)
    return db


@pytest_asyncio.fixture
async def app(settings, database):
    return create_app(settings, database)


@pytest_asyncio.fixture
async def client(app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def platform_token(client, database):
    await create_platform_admin(PlatformDB(database), "root@nova.example.com", PW)
    r = await client.post("/v2/platform/auth/login", json={"email": "root@nova.example.com", "password": PW})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def onboard(client, platform_token, slug, owner_email):
    """Create a tenant, accept the owner invite, log in. Returns (tenant_id, access, refresh)."""
    h = {"Authorization": f"Bearer {platform_token}"}
    r = await client.post("/v2/platform/tenants", headers=h, json={"config": tenant_cfg(slug), "owner_email": owner_email})
    assert r.status_code == 201, r.text
    tid, inv = r.json()["id"], r.json()["owner_invite_token"]
    r = await client.post("/v2/auth/accept-invite", json={"tenant": slug, "token": inv, "password": PW})
    assert r.status_code == 204, r.text
    r = await client.post("/v2/auth/login", json={"tenant": slug, "email": owner_email, "password": PW})
    assert r.status_code == 200, r.text
    return tid, r.json()["access_token"], r.json()["refresh_token"]


@pytest_asyncio.fixture
async def two_tenants(client, platform_token):
    a = await onboard(client, platform_token, "tenant-a", "owner@a.example.com")
    b = await onboard(client, platform_token, "tenant-b", "owner@b.example.com")
    return a, b


def tdb_of(database, tid) -> TenantDB:
    return TenantDB(database, tid)
