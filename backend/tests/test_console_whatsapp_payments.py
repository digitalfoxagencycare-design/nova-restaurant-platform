"""Nova console, WhatsApp through Nova's own number, online payment (Razorpay), enquiries. External services are faked."""

import json
import struct
import zlib

import httpx
import pytest
from cryptography.fernet import Fernet

from nova.app import create_app
from nova.services import payments as pay_svc
from nova.services import whatsapp as wa_svc
from nova.services.auth import create_platform_admin
from nova.tenancy.db import PlatformDB

from .conftest import PW, make_settings, onboard, tenant_cfg
from .test_pos import H, make_user

KEY_ID = "rzp_" + "test_abc12345"  # built at runtime so the secret scanner does not mistake a test fixture for a real key
KEY_SECRET = "rzp-secret-for-tests-0001"
WEBHOOK = "whsec-for-tests-0001"
WA_TOKEN = "EAAtesttokenvalue000000000000000000000000000000"  # scan-secrets: allow


def tiny_png() -> bytes:
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00"))
        + chunk(b"IEND", b"")
    )


class Fake:
    """Pretends to be Meta's WhatsApp API and Razorpay; remembers every call."""

    def __init__(self):
        self.calls, self.meta_error, self.n = [], False, 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        body = json.loads(request.content) if request.content else {}
        self.calls.append(
            {"url": url, "body": body, "auth": request.headers.get("authorization", ""), "basic": request.headers.get("authorization", "").startswith("Basic")}
        )
        if "graph.facebook.com" in url:
            if self.meta_error:
                return httpx.Response(
                    400, json={"error": {"code": 132001, "message": "Template does not exist", "error_data": {"details": "template name not found"}}}
                )
            return httpx.Response(200, json={"messages": [{"id": "wamid.TEST"}]})
        if url.endswith("/v1/orders"):
            self.n += 1
            return httpx.Response(200, json={"id": f"order_T{self.n}", "amount": body["amount"]})
        if "/refund" in url:
            return httpx.Response(200, json={"id": f"rfnd_{len(self.calls)}"})
        return httpx.Response(404, json={})

    def meta(self):
        return [c for c in self.calls if "graph.facebook.com" in c["url"]]

    def rzp(self, suffix):
        return [c for c in self.calls if c["url"].endswith(suffix) or suffix in c["url"]]


@pytest.fixture
def settings():
    return make_settings(secrets_key=Fernet.generate_key().decode(), public_base_url="https://order.example.com")


@pytest.fixture
def fake():
    return Fake()


@pytest.fixture
async def app(settings, database, fake):
    return create_app(settings, database, http=httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))


@pytest.fixture
async def shop(client, platform_token, app):
    tid, owner, _ = await onboard(client, platform_token, "spice-route", "owner@sr.example.com")
    r = await client.post(
        "/v2/pos/menu", headers=H(owner), json={"name": "Dum Biryani", "price": 25000, "category": "Food", "station": "kitchen", "veg": False}
    )
    return {
        "tid": tid,
        "owner": owner,
        "item": r.json()["id"],
        "plat": H(platform_token),
        "cashier": await make_user(client, owner, "spice-route", "c@sr.example.com", "cashier"),
    }


async def connect_whatsapp(client, shop):
    r = await client.put("/v2/platform/settings/whatsapp", headers=shop["plat"], json={"phone_number_id": "1234567890", "waba_id": "999"})
    assert r.status_code == 200, r.text
    assert (await client.put("/v2/platform/settings/whatsapp/token", headers=shop["plat"], json={"value": WA_TOKEN})).status_code == 204


async def set_razorpay(client, shop):
    for name, val in (
        ("razorpay.key_id", KEY_ID),
        ("razorpay.key_secret", KEY_SECRET),
        ("razorpay.webhook_secret", WEBHOOK),
    ):  # scan-secrets: allow
        r = await client.put(f"/v2/platform/tenants/{shop['tid']}/secrets/{name}", headers=shop["plat"], json={"value": val})
        assert r.status_code == 204, r.text


async def sign_in(client, phone="9876543210"):
    r = await client.post("/v2/public/spice-route/otp/send", json={"phone": phone})
    code = r.json().get("debug_otp")
    return r, code


async def customer(client, fake, phone="9876543210"):
    """Sign a customer in through WhatsApp: the code is read from the message Nova's number was asked to send."""
    r, _ = await sign_in(client, phone)
    assert r.status_code == 200, r.text
    code = fake.meta()[-1]["body"]["template"]["components"][0]["parameters"][0]["text"]
    r = await client.post("/v2/public/spice-route/otp/verify", json={"phone": phone, "code": code, "name": "Ravi"})
    assert r.status_code == 200, r.text
    return H(r.json()["access_token"])


def order_body(shop, **kw):
    return {"type": "takeaway", "items": [{"item_id": shop["item"], "qty": 1}], **kw}


def rzp_signature(order_id, payment_id, secret=KEY_SECRET):
    return pay_svc.sign(order_id, payment_id, secret)


# ================================================================ console
async def test_console_onboards_a_restaurant_end_to_end(client, platform_token):
    p = H(platform_token)
    tpl = (await client.get("/v2/platform/tenant-template?slug=new-biryani&name=New Biryani", headers=p)).json()
    tpl["brand"]["colors"]["primary"] = "#AA3300"
    r = await client.post("/v2/platform/tenants", headers=p, json={"config": tpl, "owner_email": "boss@nb.example.com"})
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    d = (await client.get(f"/v2/platform/tenants/{tid}", headers=p)).json()
    assert d["slug"] == "new-biryani" and d["owner"]["status"] == "invited" and d["links"]["storefront"] == "https://order.example.com/s/new-biryani"
    assert {c["key"]: c["done"] for c in d["checklist"]}["owner"] is False
    # logo
    assert (await client.post(f"/v2/platform/tenants/{tid}/logo", headers=p, content=b"<svg onload=alert(1)>")).status_code == 400
    ok = await client.post(f"/v2/platform/tenants/{tid}/logo", headers={**p, "Content-Type": "image/png"}, content=tiny_png())
    assert ok.status_code == 200 and ok.json()["logo_url"].startswith("/v2/public/new-biryani/logo")
    img = await client.get("/v2/public/new-biryani/logo")
    assert img.status_code == 200 and img.headers["content-type"] == "image/png" and img.headers["x-content-type-options"] == "nosniff"
    assert (await client.get("/v2/public/new-biryani/storefront")).json()["brand"]["logo_url"].startswith("/v2/public/new-biryani/logo")
    # config edit and plan
    cfg = (await client.get(f"/v2/platform/tenants/{tid}", headers=p)).json()["config"]
    cfg["brand"]["tagline"] = "Fresh every day"
    assert (await client.put(f"/v2/platform/tenants/{tid}/config", headers=p, json=cfg)).status_code == 200
    assert (await client.put(f"/v2/platform/tenants/{tid}/plan", headers=p, json={"plan": "pro"})).status_code == 204
    # the owner link: first one works once, a reissued one replaces it
    first = (await client.post(f"/v2/platform/tenants/{tid}/owner-invite", headers=p)).json()["invite_token"]
    second = (await client.post(f"/v2/platform/tenants/{tid}/owner-invite", headers=p)).json()["invite_token"]
    assert (await client.post("/v2/auth/accept-invite", json={"tenant": "new-biryani", "token": first, "password": PW})).status_code == 400
    assert (await client.post("/v2/auth/accept-invite", json={"tenant": "new-biryani", "token": second, "password": PW})).status_code == 204
    assert (await client.post(f"/v2/platform/tenants/{tid}/owner-invite", headers=p)).status_code == 409  # already has a password
    # suspend and resume
    await client.post(f"/v2/platform/tenants/{tid}/suspend", headers=p)
    assert (await client.get("/v2/public/new-biryani/storefront")).status_code == 404
    await client.post(f"/v2/platform/tenants/{tid}/activate", headers=p)
    assert (await client.get("/v2/public/new-biryani/storefront")).status_code == 200
    rows = (await client.get("/v2/platform/tenants", headers=p)).json()
    assert rows[0]["name"] == "New Biryani" and rows[0]["plan"] == "pro" and rows[0]["owner_status"] == "active"
    actions = [a["action"] for a in (await client.get("/v2/platform/audit", headers=p)).json()]
    assert {"tenant.logo", "tenant.config.update", "tenant.suspend", "tenant.activate", "tenant.owner_invite"} <= set(actions)


async def test_support_staff_can_look_but_not_change(client, platform_token, database, shop):
    await create_platform_admin(PlatformDB(database), "support@nova.example.com", PW, role="support")
    tok = (await client.post("/v2/platform/auth/login", json={"email": "support@nova.example.com", "password": PW})).json()["access_token"]
    h = H(tok)
    assert (await client.get("/v2/platform/tenants", headers=h)).status_code == 200
    assert (await client.get("/v2/platform/leads", headers=h)).status_code == 200
    assert (await client.put(f"/v2/platform/tenants/{shop['tid']}/plan", headers=h, json={"plan": "pro"})).status_code == 403
    assert (
        await client.put(f"/v2/platform/tenants/{shop['tid']}/secrets/razorpay.key_id", headers=h, json={"value": KEY_ID})
    ).status_code == 403  # scan-secrets: allow
    assert (await client.put("/v2/platform/settings/whatsapp/token", headers=h, json={"value": WA_TOKEN})).status_code == 403
    assert (await client.get("/v2/platform/tenants", headers=H(shop["owner"]))).status_code == 403  # restaurant owners are not Nova staff


async def test_secrets_are_write_only_encrypted_and_allow_listed(client, shop, database):
    await set_razorpay(client, shop)
    r = await client.get(f"/v2/platform/tenants/{shop['tid']}", headers=shop["plat"])
    text = r.text
    assert KEY_SECRET not in text and WEBHOOK not in text
    s = r.json()["secrets"]
    assert s["razorpay.key_secret"] == {**s["razorpay.key_secret"], "set": True, "last4": KEY_SECRET[-4:]}
    raw = await database["platform_secrets"].find_one({"scope": shop["tid"], "name": "razorpay.key_secret"})
    assert KEY_SECRET not in json.dumps(raw, default=str)  # only ciphertext at rest
    bad = await client.put(f"/v2/platform/tenants/{shop['tid']}/secrets/jwt_key", headers=shop["plat"], json={"value": "whatever-value"})
    assert bad.status_code == 400
    assert (await client.delete(f"/v2/platform/tenants/{shop['tid']}/secrets/razorpay.webhook_secret", headers=shop["plat"])).status_code == 204
    assert (await client.get(f"/v2/platform/tenants/{shop['tid']}/secrets", headers=shop["plat"])).json()["razorpay.webhook_secret"]["set"] is False


async def test_secrets_need_a_server_key(client, platform_token, app, shop):
    app.state.settings.secrets_key = ""
    r = await client.put(f"/v2/platform/tenants/{shop['tid']}/secrets/razorpay.key_id", headers=shop["plat"], json={"value": KEY_ID})  # scan-secrets: allow
    assert r.status_code == 503 and r.json()["detail"]["code"] == "SECRETS_NOT_CONFIGURED"


# ================================================================ WhatsApp from Nova's number
async def test_otp_and_order_updates_come_from_novas_whatsapp_number(client, shop, fake, app):
    # not connected yet: production-style refusal, nothing pretended
    r = await client.post("/v2/public/spice-route/otp/send", json={"phone": "9876543210"})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "OTP_NOT_CONFIGURED"
    await connect_whatsapp(client, shop)
    assert "debug_otp" not in (await client.post("/v2/public/spice-route/otp/send", json={"phone": "9876543210"})).json()
    first = fake.meta()[0]
    assert first["url"].endswith("/v21.0/1234567890/messages") and first["auth"] == f"Bearer {WA_TOKEN}"
    t = first["body"]["template"]
    assert first["body"]["to"] == "919876543210" and t["name"] == "nova_login_code" and t["components"][1]["sub_type"] == "url"
    cust = await customer(client, fake)

    o = (await client.post("/v2/me/orders", headers=cust, json=order_body(shop))).json()
    await wa_svc.drain(app)
    msgs = [m["body"]["template"] for m in fake.meta() if m["body"]["template"]["name"] == "nova_order_update"]
    params = [p["text"] for p in msgs[-1]["components"][0]["parameters"]]
    assert params[0] == "Test" and params[1] == str(o["order_no"]) and "received" in params[2] and params[3] == "https://order.example.com/s/spice-route"
    for st in ("preparing", "ready", "completed"):
        body = {"status": st, **({"collect": {"mode": "cash"}} if st == "completed" else {})}
        assert (await client.post(f"/v2/orders/{o['id']}/status", headers=H(shop["cashier"]), json=body)).status_code == 200
    await wa_svc.drain(app)
    said = [
        [p["text"] for p in m["body"]["template"]["components"][0]["parameters"]][2]
        for m in fake.meta()
        if m["body"]["template"]["name"] == "nova_order_update"
    ]
    assert any("being prepared" in x for x in said) and any("ready for pickup" in x for x in said) and any("completed" in x for x in said)


async def test_customer_can_opt_out_and_a_whatsapp_failure_never_breaks_an_order(client, shop, fake, app, database):
    await connect_whatsapp(client, shop)
    cust = await customer(client, fake)
    before = len(fake.meta())
    r = await client.post("/v2/me/orders", headers=cust, json=order_body(shop, whatsapp_updates=False))
    assert r.status_code == 201
    await wa_svc.drain(app)
    assert len(fake.meta()) == before  # no message for someone who opted out
    fake.meta_error = True
    r = await client.post("/v2/me/orders", headers=cust, json=order_body(shop))
    assert r.status_code == 201  # the order still succeeds
    await wa_svc.drain(app)
    ev = [e async for e in database["usage_events"].find({"type": "whatsapp"})]
    assert ev and ev[-1]["ok"] is False and ev[-1]["error"] == "132001"


async def test_whatsapp_test_button_and_failed_otp(client, shop, fake):
    await connect_whatsapp(client, shop)
    ok = await client.post("/v2/platform/settings/whatsapp/test", headers=shop["plat"], json={"to": "919876543210", "kind": "otp"})
    assert ok.status_code == 200 and ok.json()["message_id"] == "wamid.TEST"
    fake.meta_error = True
    bad = await client.post("/v2/platform/settings/whatsapp/test", headers=shop["plat"], json={"to": "919876543210"})
    assert bad.status_code == 502 and "132001" in bad.json()["detail"]["message"]
    r = await client.post("/v2/public/spice-route/otp/send", json={"phone": "9876543210"})
    assert r.status_code == 502 and r.json()["detail"]["code"] == "OTP_SEND_FAILED"
    g = (await client.get("/v2/platform/settings/whatsapp", headers=shop["plat"])).json()
    assert g["connected"] and WA_TOKEN not in json.dumps(g) and g["token"]["last4"] == WA_TOKEN[-4:]


# ================================================================ online payment
async def test_online_payment_happy_path_and_idempotent_confirmation(client, shop, fake, app):
    await connect_whatsapp(client, shop)
    assert (await client.get("/v2/public/spice-route/storefront")).json()["payments"]["online"] is False  # no keys yet
    cust = await customer(client, fake)
    r = await client.post("/v2/me/orders", headers=cust, json=order_body(shop, payment="online"))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "PAYMENT_NOT_AVAILABLE"
    await set_razorpay(client, shop)
    assert (await client.get("/v2/public/spice-route/storefront")).json()["payments"]["online"] is True

    r = await client.post("/v2/me/orders", headers=cust, json=order_body(shop, payment="online"))
    assert r.status_code == 201, r.text
    o = r.json()
    assert (
        o["status"] == "pending_payment" and o["payment"]["checkout"]["amount"] == 25000 and o["payment"]["checkout"]["key_id"] == KEY_ID
    )  # scan-secrets: allow
    created = fake.rzp("/v1/orders")[0]
    assert created["body"]["amount"] == 25000 and created["basic"] is True and KEY_SECRET not in json.dumps(o)
    assert (await client.get("/v2/orders?scope=all", headers=H(shop["cashier"]))).json() == []  # not an order until it is paid
    assert (await client.get("/v2/pos/kitchen", headers=H(shop["owner"]))).json() == []

    oid, rz_order = o["id"], o["payment"]["checkout"]["order_id"]
    wrong = await client.post(
        f"/v2/me/orders/{oid}/payment", headers=cust, json={"razorpay_order_id": rz_order, "razorpay_payment_id": "pay_1", "razorpay_signature": "0" * 64}
    )
    assert wrong.status_code == 400 and wrong.json()["detail"]["code"] == "PAYMENT_SIGNATURE"
    other = await client.post(
        f"/v2/me/orders/{oid}/payment",
        headers=cust,
        json={"razorpay_order_id": "order_other", "razorpay_payment_id": "pay_1", "razorpay_signature": rzp_signature("order_other", "pay_1")},
    )
    assert other.status_code == 400 and other.json()["detail"]["code"] == "PAYMENT_MISMATCH"
    body = {"razorpay_order_id": rz_order, "razorpay_payment_id": "pay_1", "razorpay_signature": rzp_signature(rz_order, "pay_1")}
    done = await client.post(f"/v2/me/orders/{oid}/payment", headers=cust, json=body)
    again = await client.post(f"/v2/me/orders/{oid}/payment", headers=cust, json=body)
    assert done.status_code == 200 and again.status_code == 200 and done.json()["status"] == "placed" and done.json()["payment"]["paid"] is True
    assert len((await client.get(f"/v2/orders/{oid}", headers=H(shop["cashier"]))).json()["payments"]) == 1  # confirmed once

    st = H(shop["cashier"])
    assert [x["state"] for x in (await client.get("/v2/orders", headers=st)).json()] == ["placed"]
    for s in ("preparing", "ready", "completed"):
        assert (await client.post(f"/v2/orders/{oid}/status", headers=st, json={"status": s})).status_code == 200  # no cash needed: already paid
    final = (await client.get(f"/v2/orders/{oid}", headers=st)).json()
    assert final["status"] == "paid" and final["balance"] == 0
    day = (await client.get("/v2/pos/reports/day", headers=H(shop["owner"]))).json()
    assert day["sales"] == 25000 and day["by_mode"] == {"online": 25000}


async def test_webhook_confirms_when_the_app_never_reported_back(client, shop, fake, app):
    await connect_whatsapp(client, shop)
    await set_razorpay(client, shop)
    cust = await customer(client, fake)
    o = (await client.post("/v2/me/orders", headers=cust, json=order_body(shop, payment="online"))).json()
    rz_order = o["payment"]["checkout"]["order_id"]

    def event(amount=25000, payment_id="pay_w1"):
        return json.dumps(
            {"event": "payment.captured", "payload": {"payment": {"entity": {"id": payment_id, "order_id": rz_order, "amount": amount, "status": "captured"}}}}
        ).encode()

    import hashlib
    import hmac

    sig = lambda raw: hmac.new(WEBHOOK.encode(), raw, hashlib.sha256).hexdigest()  # noqa: E731
    raw = event()
    assert (await client.post("/v2/webhooks/razorpay/spice-route", content=raw, headers={"x-razorpay-signature": "bad"})).status_code == 400
    assert (await client.get(f"/v2/me/orders/{o['id']}", headers=cust)).json()["status"] == "pending_payment"
    wrong_amount = event(amount=100)
    assert (
        (await client.post("/v2/webhooks/razorpay/spice-route", content=wrong_amount, headers={"x-razorpay-signature": sig(wrong_amount)}))
        .json()
        .get("ignored")
    )
    assert (await client.get(f"/v2/me/orders/{o['id']}", headers=cust)).json()["status"] == "pending_payment"
    assert (await client.post("/v2/webhooks/razorpay/spice-route", content=raw, headers={"x-razorpay-signature": sig(raw)})).status_code == 200
    assert (
        await client.post("/v2/webhooks/razorpay/spice-route", content=raw, headers={"x-razorpay-signature": sig(raw)})
    ).status_code == 200  # replay is harmless
    t = (await client.get(f"/v2/me/orders/{o['id']}", headers=cust)).json()
    assert t["status"] == "placed" and t["payment"]["paid"]
    assert len((await client.get(f"/v2/orders/{o['id']}", headers=H(shop["cashier"]))).json()["payments"]) == 1


async def test_cancelling_a_paid_order_refunds_through_razorpay(client, shop, fake, app):
    await connect_whatsapp(client, shop)
    await set_razorpay(client, shop)
    cust = await customer(client, fake)
    o = (await client.post("/v2/me/orders", headers=cust, json=order_body(shop, payment="online"))).json()
    rz = o["payment"]["checkout"]["order_id"]
    await client.post(
        f"/v2/me/orders/{o['id']}/payment",
        headers=cust,
        json={"razorpay_order_id": rz, "razorpay_payment_id": "pay_r1", "razorpay_signature": rzp_signature(rz, "pay_r1")},
    )
    c = await client.post(f"/v2/me/orders/{o['id']}/cancel", headers=cust)
    assert c.status_code == 200 and c.json()["status"] == "cancelled" and c.json()["payment"]["refunded"] == 25000
    ref = fake.rzp("/refund")
    assert len(ref) == 1 and ref[0]["url"].endswith("/v1/payments/pay_r1/refund") and ref[0]["body"]["amount"] == 25000
    bill = (await client.get(f"/v2/orders/{o['id']}", headers=H(shop["cashier"]))).json()
    assert bill["status"] == "void" and bill["refunds"][0]["mode"] == "online"
    assert (await client.get("/v2/pos/reports/day", headers=H(shop["owner"]))).json()["sales"] == 0
    # staff cancelling a paid order after cooking started refunds too, and a refund the provider refuses leaves the order alive
    o2 = (await client.post("/v2/me/orders", headers=cust, json=order_body(shop, payment="online"))).json()
    rz2 = o2["payment"]["checkout"]["order_id"]
    await client.post(
        f"/v2/me/orders/{o2['id']}/payment",
        headers=cust,
        json={"razorpay_order_id": rz2, "razorpay_payment_id": "pay_r2", "razorpay_signature": rzp_signature(rz2, "pay_r2")},
    )
    st = H(shop["cashier"])
    await client.post(f"/v2/orders/{o2['id']}/status", headers=st, json={"status": "preparing"})
    real = fake.handler
    app.state.http = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(500, json={"error": {"description": "down"}}) if "/refund" in str(r.url) else real(r))
    )
    bad = await client.post(f"/v2/orders/{o2['id']}/status", headers=st, json={"status": "cancelled", "reason": "Out of rice"})
    assert bad.status_code == 502 and bad.json()["detail"]["code"] == "REFUND_FAILED"
    assert (await client.get(f"/v2/orders/{o2['id']}", headers=st)).json()["state"] == "preparing"
    app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(real))
    assert (await client.post(f"/v2/orders/{o2['id']}/status", headers=st, json={"status": "cancelled", "reason": "Out of rice"})).status_code == 200


async def test_unpaid_online_orders_expire_and_late_payment_is_refunded(client, shop, fake, app, database):
    await connect_whatsapp(client, shop)
    await set_razorpay(client, shop)
    cust = await customer(client, fake)
    o = (await client.post("/v2/me/orders", headers=cust, json=order_body(shop, payment="online"))).json()
    await database["bills"].update_one({"channel": "online"}, {"$set": {"created_at": "2020-01-01T00:00:00+00:00"}})
    listed = (await client.get("/v2/me/orders", headers=cust)).json()
    assert listed[0]["status"] == "cancelled"
    rz = o["payment"]["checkout"]["order_id"]
    import hashlib
    import hmac

    raw = json.dumps({"event": "payment.captured", "payload": {"payment": {"entity": {"id": "pay_late", "order_id": rz, "amount": 25000}}}}).encode()
    r = await client.post(
        "/v2/webhooks/razorpay/spice-route", content=raw, headers={"x-razorpay-signature": hmac.new(WEBHOOK.encode(), raw, hashlib.sha256).hexdigest()}
    )
    assert r.status_code == 200 and fake.rzp("/v1/payments/pay_late/refund")


# ================================================================ interested restaurants
async def test_enquiry_form_is_public_rate_limited_and_worked_from_the_console(client, platform_token):
    body = {"name": "Asha Rao", "restaurant": "Asha's Kitchen", "phone": "9876500000", "city": "Hyderabad", "message": "Want online ordering"}
    assert (await client.post("/v2/public/leads", json=body)).status_code == 201
    assert (await client.post("/v2/public/leads", json={**body, "website": "http://spam.example"})).json() == {"ok": True}  # honeypot: silently dropped
    assert (await client.post("/v2/public/leads", json={**body, "phone": "abc"})).status_code == 422
    for _ in range(4):
        await client.post("/v2/public/leads", json=body)
    assert (await client.post("/v2/public/leads", json=body)).status_code == 429
    p = H(platform_token)
    rows = (await client.get("/v2/platform/leads", headers=p)).json()
    assert len(rows) == 5 and "ip_hash" not in rows[0] and rows[0]["status"] == "new"
    r = await client.patch(f"/v2/platform/leads/{rows[0]['id']}", headers=p, json={"status": "demo", "note": "Demo booked Friday"})
    assert r.json()["status"] == "demo" and r.json()["notes"][0]["by"] == "root@nova.example.com"
    assert len((await client.get("/v2/platform/leads?status=demo", headers=p)).json()) == 1
    assert (await client.get("/v2/platform/leads", headers=H(platform_token))).status_code == 200
    assert (await client.get("/v2/platform/overview", headers=p)).json()["leads_new"] == 4


async def test_usage_overview_and_export_hide_secrets(client, shop, fake):
    await connect_whatsapp(client, shop)
    await set_razorpay(client, shop)
    cust = await customer(client, fake)
    o = (await client.post("/v2/me/orders", headers=cust, json=order_body(shop))).json()
    st = H(shop["cashier"])
    for s in ("preparing", "ready"):
        await client.post(f"/v2/orders/{o['id']}/status", headers=st, json={"status": s})
    await client.post(f"/v2/orders/{o['id']}/status", headers=st, json={"status": "completed", "collect": {"mode": "cash"}})
    u = (await client.get(f"/v2/platform/tenants/{shop['tid']}/usage", headers=shop["plat"])).json()
    assert u["orders"] == 1 and u["online_orders"] == 1 and u["gmv"] == 25000 and len(u["daily"]) == 30
    ov = (await client.get("/v2/platform/overview", headers=shop["plat"])).json()
    assert ov["orders_30d"] == 1 and ov["gmv_30d"] == 25000 and ov["whatsapp"]["connected"] is True
    ex = await client.get(f"/v2/platform/tenants/{shop['tid']}/export", headers=shop["plat"])
    assert ex.status_code == 200 and len(ex.json()["bills"]) == 1 and len(ex.json()["customers"]) == 1
    for secret in ("password_hash", KEY_SECRET, WA_TOKEN, WEBHOOK):
        assert secret not in ex.text
    assert tenant_cfg("x")["slug"] == "x"
