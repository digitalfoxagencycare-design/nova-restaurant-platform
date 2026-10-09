"""End to end: two real tenants through the HTTP API. Everything here must fail closed."""
import copy

from tests.conftest import PW, onboard, tdb_of, tenant_cfg


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


async def test_each_tenant_sees_only_its_own_config_and_users(client, two_tenants):
    (ta, a, _), (tb, b, _) = two_tenants
    ra = (await client.get("/v2/tenants/me", headers=H(a))).json()
    rb = (await client.get("/v2/tenants/me", headers=H(b))).json()
    assert ra["id"] == ta and ra["slug"] == "tenant-a"
    assert rb["id"] == tb and rb["slug"] == "tenant-b"
    ua = [u["email"] for u in (await client.get("/v2/users", headers=H(a))).json()]
    ub = [u["email"] for u in (await client.get("/v2/users", headers=H(b))).json()]
    assert ua == ["owner@a.example.com"] and ub == ["owner@b.example.com"]


async def test_client_cannot_choose_tenant_by_header_query_or_body(client, two_tenants):
    (ta, a, _), (tb, _, _) = two_tenants
    for extra in ({"headers": {**H(a), "X-Tenant": "tenant-b", "X-Tenant-Id": tb}}, {"headers": H(a), "params": {"tenant_id": tb, "tenant": "tenant-b"}}):
        r = await client.get("/v2/tenants/me", **extra)
        assert r.json()["id"] == ta
    r = await client.get("/v2/users", headers={**H(a), "X-Tenant": "tenant-b"})
    assert [u["email"] for u in r.json()] == ["owner@a.example.com"]


async def test_token_for_one_tenant_cannot_be_used_after_tid_swap(client, two_tenants, settings):
    from datetime import timedelta

    from nova.core.security import encode_token
    (ta, a, _), (tb, _, _) = two_tenants
    # a forged token for tenant B with tenant A's user id must not authenticate (signature is valid, user is not in B)
    uid = (await client.get("/v2/users", headers=H(a))).json()[0]["id"]
    forged, _ = encode_token(settings, {"sub": uid, "tid": tb, "role": "owner", "ver": 0, "kind": "tenant"}, timedelta(minutes=5), "access")
    r = await client.get("/v2/users", headers=H(forged))
    assert r.status_code == 401


async def test_config_update_is_scoped_validated_audited_and_versioned(client, two_tenants, database):
    (ta, a, _), (tb, b, _) = two_tenants
    cfg = tenant_cfg("tenant-a")
    cfg["tax"]["default_rate"] = 0.12
    r = await client.put("/v2/tenants/me/config", headers=H(a), json=cfg)
    assert r.status_code == 200 and r.json()["config_version"] == 2 and r.json()["changed_sections"] == ["tax"]
    assert (await client.get("/v2/tenants/me", headers=H(b))).json()["config"]["tax"]["default_rate"] == 0.05  # B untouched
    audit = (await client.get("/v2/audit", headers=H(a))).json()
    assert any(x["action"] == "tenant.config.update" for x in audit)
    assert await tdb_of(database, tb).audit_log.count_documents({"action": "tenant.config.update"}) == 0


async def test_config_validation_errors_and_slug_immutable(client, two_tenants):
    (_, a, _), _ = two_tenants
    bad = tenant_cfg("tenant-a")
    bad["tax"]["default_rate"] = 5
    r = await client.put("/v2/tenants/me/config", headers=H(a), json=bad)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "INVALID_CONFIG"
    r = await client.put("/v2/tenants/me/config", headers=H(a), json=tenant_cfg("tenant-b"))
    assert r.json()["detail"]["code"] == "SLUG_IMMUTABLE"


async def test_roles_enforced(client, two_tenants):
    (_, a, _), _ = two_tenants
    r = await client.post("/v2/users", headers=H(a), json={"email": "cash@a.example.com", "role": "cashier"})
    assert r.status_code == 201
    inv = r.json()["invite_token"]
    assert (await client.post("/v2/auth/accept-invite", json={"tenant": "tenant-a", "token": inv, "password": PW})).status_code == 204
    cashier = (await client.post("/v2/auth/login", json={"tenant": "tenant-a", "email": "cash@a.example.com", "password": PW})).json()["access_token"]
    assert (await client.get("/v2/tenants/me", headers=H(cashier))).status_code == 200            # config.view
    assert (await client.put("/v2/tenants/me/config", headers=H(cashier), json=tenant_cfg("tenant-a"))).status_code == 403
    assert (await client.get("/v2/users", headers=H(cashier))).status_code == 403                 # users.view not granted
    assert (await client.post("/v2/users", headers=H(cashier), json={"email": "x@a.example.com", "role": "viewer"})).status_code == 403
    # owner role cannot be handed out by invite
    r = await client.post("/v2/users", headers=H(a), json={"email": "o2@a.example.com", "role": "owner"})
    assert r.status_code == 400


async def test_same_email_in_two_tenants_are_distinct_accounts(client, platform_token):
    await onboard(client, platform_token, "shop-one", "same@x.example.com")
    await onboard(client, platform_token, "shop-two", "same@x.example.com")
    r = await client.post("/v2/auth/login", json={"tenant": "shop-one", "email": "same@x.example.com", "password": PW})
    assert r.status_code == 200
    r = await client.post("/v2/auth/login", json={"tenant": "shop-three", "email": "same@x.example.com", "password": PW})
    assert r.status_code == 401


async def test_tenant_token_cannot_use_platform_endpoints_and_vice_versa(client, two_tenants, platform_token):
    (_, a, _), _ = two_tenants
    assert (await client.get("/v2/platform/tenants", headers=H(a))).status_code == 403
    assert (await client.post("/v2/platform/tenants", headers=H(a), json={"config": tenant_cfg("evil"), "owner_email": "e@e.example.com"})).status_code == 403
    assert (await client.get("/v2/tenants/me", headers=H(platform_token))).status_code == 403
    assert (await client.get("/v2/users", headers=H(platform_token))).status_code == 403


async def test_no_default_accounts_and_unauthenticated_access(client):
    for path in ("/v2/tenants/me", "/v2/users", "/v2/audit", "/v2/platform/tenants"):
        assert (await client.get(path)).status_code == 401
    assert (await client.get("/api/setup/seed")).status_code == 404  # the old public seeding endpoint does not exist
    r = await client.post("/v2/auth/login", json={"tenant": "tenant-a", "email": "admin@nova.example.com", "password": "9701463241"})
    assert r.status_code == 401


async def test_suspended_tenant_is_locked_out_immediately(client, two_tenants, platform_token):
    (ta, a, _), (_, b, _) = two_tenants
    assert (await client.post(f"/v2/platform/tenants/{ta}/suspend", headers=H(platform_token))).status_code == 204
    assert (await client.get("/v2/tenants/me", headers=H(a))).status_code == 401        # existing token dies
    assert (await client.post("/v2/auth/login", json={"tenant": "tenant-a", "email": "owner@a.example.com", "password": PW})).status_code == 401
    assert (await client.get("/v2/tenants/me", headers=H(b))).status_code == 200        # B unaffected


async def test_duplicate_slug_and_bad_slug(client, platform_token):
    await onboard(client, platform_token, "dupe-shop", "o@d.example.com")
    r = await client.post("/v2/platform/tenants", headers=H(platform_token), json={"config": tenant_cfg("dupe-shop"), "owner_email": "o2@d.example.com"})
    assert r.status_code == 409
    cfg = copy.deepcopy(tenant_cfg("x"))
    r = await client.post("/v2/platform/tenants", headers=H(platform_token), json={"config": cfg, "owner_email": "o@x.example.com"})
    assert r.status_code == 400
