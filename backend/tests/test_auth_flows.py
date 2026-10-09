from tests.conftest import PW, onboard


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


async def test_refresh_rotates_and_reuse_revokes_family(client, platform_token):
    _, access, refresh = await onboard(client, platform_token, "shop-r", "o@r.example.com")
    r1 = await client.post("/v2/auth/refresh", json={"tenant": "shop-r", "refresh_token": refresh})
    assert r1.status_code == 200
    new_refresh = r1.json()["refresh_token"]
    # replaying the OLD refresh token is treated as theft: it fails and kills the new one too
    assert (await client.post("/v2/auth/refresh", json={"tenant": "shop-r", "refresh_token": refresh})).status_code == 401
    assert (await client.post("/v2/auth/refresh", json={"tenant": "shop-r", "refresh_token": new_refresh})).status_code == 401


async def test_refresh_token_not_accepted_as_access_and_wrong_tenant(client, platform_token):
    _, access, refresh = await onboard(client, platform_token, "shop-s", "o@s.example.com")
    await onboard(client, platform_token, "shop-t", "o@t.example.com")
    assert (await client.get("/v2/tenants/me", headers=H(refresh))).status_code == 401
    assert (await client.post("/v2/auth/refresh", json={"tenant": "shop-t", "refresh_token": refresh})).status_code == 401


async def test_logout_revokes_refresh(client, platform_token):
    _, _, refresh = await onboard(client, platform_token, "shop-l", "o@l.example.com")
    assert (await client.post("/v2/auth/logout", json={"tenant": "shop-l", "refresh_token": refresh})).status_code == 204
    assert (await client.post("/v2/auth/refresh", json={"tenant": "shop-l", "refresh_token": refresh})).status_code == 401


async def test_lockout_after_repeated_failures(client, platform_token):
    await onboard(client, platform_token, "shop-k", "o@k.example.com")
    for _ in range(5):
        r = await client.post("/v2/auth/login", json={"tenant": "shop-k", "email": "o@k.example.com", "password": "wrong-password-1"})
        assert r.status_code == 401
    r = await client.post("/v2/auth/login", json={"tenant": "shop-k", "email": "o@k.example.com", "password": PW})  # even the right one
    assert r.status_code == 429 and r.json()["detail"]["code"] == "ACCOUNT_LOCKED"


async def test_login_errors_do_not_reveal_whether_account_exists(client, platform_token):
    await onboard(client, platform_token, "shop-e", "o@e.example.com")
    a = await client.post("/v2/auth/login", json={"tenant": "shop-e", "email": "o@e.example.com", "password": "wrong-password-1"})
    b = await client.post("/v2/auth/login", json={"tenant": "shop-e", "email": "nobody@e.example.com", "password": "wrong-password-1"})
    c = await client.post("/v2/auth/login", json={"tenant": "no-such", "email": "o@e.example.com", "password": "wrong-password-1"})
    assert a.status_code == b.status_code == c.status_code == 401
    assert a.json()["detail"]["message"] == b.json()["detail"]["message"]


async def test_invite_is_single_use_and_password_rules(client, platform_token):
    h = H(platform_token)
    from tests.conftest import tenant_cfg
    r = await client.post("/v2/platform/tenants", headers=h, json={"config": tenant_cfg("shop-i"), "owner_email": "o@i.example.com"})
    token = r.json()["owner_invite_token"]
    weak = await client.post("/v2/auth/accept-invite", json={"tenant": "shop-i", "token": token, "password": "short"})
    assert weak.status_code == 400 and weak.json()["detail"]["code"] == "WEAK_PASSWORD"
    assert (await client.post("/v2/auth/accept-invite", json={"tenant": "shop-i", "token": token, "password": PW})).status_code == 204
    again = await client.post("/v2/auth/accept-invite", json={"tenant": "shop-i", "token": token, "password": "Another-Pass-77"})
    assert again.status_code == 400
    # invite token for tenant A is useless against tenant B
    await onboard(client, platform_token, "shop-j", "o@j.example.com")
    assert (await client.post("/v2/auth/accept-invite", json={"tenant": "shop-j", "token": token, "password": PW})).status_code == 400


async def test_cannot_log_in_before_accepting_invite(client, platform_token):
    from tests.conftest import tenant_cfg
    await client.post("/v2/platform/tenants", headers=H(platform_token), json={"config": tenant_cfg("shop-p"), "owner_email": "o@p.example.com"})
    r = await client.post("/v2/auth/login", json={"tenant": "shop-p", "email": "o@p.example.com", "password": ""})
    assert r.status_code == 401


async def test_platform_login_wrong_password(client, platform_token):
    r = await client.post("/v2/platform/auth/login", json={"email": "root@nova.example.com", "password": "wrong-password-1"})
    assert r.status_code == 401
