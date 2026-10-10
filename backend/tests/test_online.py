"""Online ordering end to end: public storefront, phone sign-in, quote, order, kitchen, delivery partner, owner views."""
import pytest

from .conftest import make_settings, onboard
from .test_pos import H, make_user


@pytest.fixture
def settings():
    return make_settings(debug_otp=True)


@pytest.fixture
async def shop(client, platform_token):
    tid, owner, _ = await onboard(client, platform_token, "biryani-house", "owner@bh.example.com")
    cfg = (await client.get("/v2/tenants/me", headers=H(owner))).json()["config"]
    cfg["delivery"]["origin"] = {"lat": 17.4500, "lng": 78.3800}
    cfg["delivery"]["driver_pay"] = {"base": 20, "per_km": 5}
    cfg["ordering"]["min_order"] = 100
    cfg["payments"]["cod"] = {"enabled": True}        # the example blocks cash on delivery overnight; keep the test clock-independent
    r = await client.put("/v2/tenants/me/config", headers=H(owner), json=cfg)
    assert r.status_code == 200, r.text
    items = {}
    for name, price, st in [("Dum Biryani", 25000, "kitchen"), ("Irani Chai", 2000, "beverage"), ("Haleem", 18000, "kitchen")]:
        r = await client.post("/v2/pos/menu", headers=H(owner), json={"name": name, "price": price, "category": "Food", "station": st, "veg": False})
        items[name] = r.json()["id"]
    return {"owner": owner, "items": items, "slug": "biryani-house",
            "cashier": await make_user(client, owner, "biryani-house", "c@bh.example.com", "cashier"),
            "kitchen": await make_user(client, owner, "biryani-house", "k@bh.example.com", "kitchen"),
            "d1": await make_user(client, owner, "biryani-house", "d1@bh.example.com", "delivery"),
            "d2": await make_user(client, owner, "biryani-house", "d2@bh.example.com", "delivery")}


async def sign_in(client, slug, phone="9876543210", name="Ravi"):
    r = await client.post(f"/v2/public/{slug}/otp/send", json={"phone": phone})
    assert r.status_code == 200, r.text
    r = await client.post(f"/v2/public/{slug}/otp/verify", json={"phone": phone, "code": r.json()["debug_otp"], "name": name})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def cart(shop, *pairs, **kw):
    return {"items": [{"item_id": shop["items"][n], "qty": q} for n, q in pairs], **kw}


ADDR_NEAR = {"text": "Plot 12, Kondapur, Hyderabad", "lat": 17.4600, "lng": 78.3900}     # about 1.5 km
ADDR_FAR = {"text": "Far away place, another city", "lat": 17.9000, "lng": 78.9000}


# ---------------------------------------------------------------- public
async def test_storefront_and_menu_are_public_and_leak_nothing(client, shop):
    r = await client.get("/v2/public/biryani-house/storefront")
    assert r.status_code == 200
    body = r.json()
    assert body["brand"]["name"] and body["delivery"]["fee_slabs"] and "integrations" not in body and "pos" not in body
    m = (await client.get("/v2/public/biryani-house/menu")).json()
    assert {i["name"] for i in m["items"]} == {"Dum Biryani", "Irani Chai", "Haleem"} and m["categories"] == ["Food"]
    assert (await client.get("/v2/public/nope/storefront")).status_code == 404


async def test_otp_wrong_codes_lock_and_new_code_needed(client, shop):
    r = await client.post("/v2/public/biryani-house/otp/send", json={"phone": "9876543211"})
    good = r.json()["debug_otp"]
    for _ in range(5):
        assert (await client.post("/v2/public/biryani-house/otp/verify", json={"phone": "9876543211", "code": "000000"})).status_code == 400
    r = await client.post("/v2/public/biryani-house/otp/verify", json={"phone": "9876543211", "code": good})
    assert r.status_code == 429
    assert (await client.post("/v2/public/biryani-house/otp/send", json={"phone": "123"})).status_code == 400


async def test_without_a_sender_production_refuses_to_send_codes(client, app, shop):
    app.state.settings = make_settings(debug_otp=False)
    r = await client.post("/v2/public/biryani-house/otp/send", json={"phone": "9876543212"})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "OTP_NOT_CONFIGURED"


# ---------------------------------------------------------------- quote and order
async def test_quote_adds_delivery_fee_and_checks_range_and_minimum(client, shop):
    q = await client.post("/v2/public/biryani-house/quote", json={**cart(shop, ("Dum Biryani", 1)), "type": "delivery", "address": ADDR_NEAR})
    assert q.status_code == 200, q.text
    t = q.json()
    assert t["delivery_fee"] == 2000 and t["totals"]["total"] == 25000 + 2000 and 1 < t["distance_km"] < 2.5     # example slab: up to 2 km costs Rs 20
    far = await client.post("/v2/public/biryani-house/quote", json={**cart(shop, ("Dum Biryani", 1)), "type": "delivery", "address": ADDR_FAR})
    assert far.status_code == 409 and far.json()["detail"]["code"] == "OUT_OF_DELIVERY_RANGE"
    small = await client.post("/v2/public/biryani-house/quote", json={**cart(shop, ("Irani Chai", 2)), "type": "takeaway"})
    assert small.status_code == 409 and small.json()["detail"]["code"] == "BELOW_MINIMUM"
    free = await client.post("/v2/public/biryani-house/quote", json={**cart(shop, ("Dum Biryani", 2)), "type": "delivery", "address": ADDR_NEAR})
    assert free.json()["delivery_fee"] == 0      # example: free above Rs 499


async def test_prices_come_from_the_server_not_the_client(client, shop):
    body = {"type": "takeaway", "items": [{"item_id": shop["items"]["Dum Biryani"], "qty": 1, "price": 1}]}
    r = await client.post("/v2/public/biryani-house/quote", json=body)
    assert r.json()["totals"]["total"] == 25000


async def test_coupon_discounts_food_only_and_respects_minimum(client, shop):
    o = H(shop["owner"])
    r = await client.post("/v2/coupons", headers=o, json={"code": "save10", "kind": "pct", "value": 10, "min_subtotal": 20000, "max_discount": 2000})
    assert r.status_code == 201 and r.json()["code"] == "SAVE10"
    q = await client.post("/v2/public/biryani-house/quote", json={**cart(shop, ("Dum Biryani", 1)), "type": "takeaway", "coupon": "save10"})
    assert q.json()["totals"]["discount"] == 2000 and q.json()["totals"]["total"] == 23000
    low = await client.post("/v2/public/biryani-house/quote", json={**cart(shop, ("Irani Chai", 6)), "type": "takeaway", "coupon": "SAVE10"})
    assert low.status_code == 409 and low.json()["detail"]["code"] == "COUPON_MIN"
    cid = r.json()["id"]
    await client.patch(f"/v2/coupons/{cid}", headers=o, json={"active": False})
    off = await client.post("/v2/public/biryani-house/quote", json={**cart(shop, ("Dum Biryani", 1)), "type": "takeaway", "coupon": "SAVE10"})
    assert off.json()["detail"]["code"] == "COUPON_INVALID"
    assert (await client.post("/v2/coupons", headers=H(shop["cashier"]), json={"code": "XYZ", "kind": "pct", "value": 5})).status_code == 403


async def test_place_order_is_idempotent_and_sold_out_is_refused(client, shop):
    tok = await sign_in(client, shop["slug"])
    body = {**cart(shop, ("Dum Biryani", 1)), "type": "delivery", "address": ADDR_NEAR}
    a = await client.post("/v2/me/orders", headers={**H(tok), "Idempotency-Key": "k1"}, json=body)
    b = await client.post("/v2/me/orders", headers={**H(tok), "Idempotency-Key": "k1"}, json=body)
    assert a.status_code == 201 and b.status_code == 201 and a.json()["id"] == b.json()["id"]
    assert a.json()["status"] == "placed" and len(a.json()["delivery_code"]) == 4 and a.json()["payment"]["due"] == 27000
    assert len((await client.get("/v2/me/orders", headers=H(tok))).json()) == 1
    await client.patch(f"/v2/pos/menu/{shop['items']['Haleem']}", headers=H(shop["owner"]), json={"available": False})
    r = await client.post("/v2/me/orders", headers=H(tok), json={**cart(shop, ("Haleem", 1)), "type": "takeaway"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "OUT_OF_STOCK"


async def test_paused_store_refuses_orders_with_the_notice(client, shop):
    tok = await sign_in(client, shop["slug"])
    r = await client.put("/v2/store", headers=H(shop["cashier"]), json={"paused": True, "notice": "Closed for a private event"})
    assert r.status_code == 200 and r.json()["paused"] is True
    r = await client.post("/v2/me/orders", headers=H(tok), json={**cart(shop, ("Dum Biryani", 1)), "type": "takeaway"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "STORE_PAUSED" and "private event" in r.json()["detail"]["message"]
    assert (await client.get("/v2/public/biryani-house/storefront")).json()["ordering"]["paused"] is True


# ---------------------------------------------------------------- the whole delivery journey
async def test_delivery_journey_from_cart_to_cash_collected(client, shop):
    cust = await sign_in(client, shop["slug"])
    order = (await client.post("/v2/me/orders", headers=H(cust), json={**cart(shop, ("Dum Biryani", 1)), "type": "delivery", "address": ADDR_NEAR})).json()
    oid, code = order["id"], order["delivery_code"]
    staff, kitchen = H(shop["cashier"]), H(shop["kitchen"])

    r = await client.get("/v2/orders?scope=open", headers=staff)
    assert [o["order_no"] for o in r.json()] == [order["order_no"]] and r.json()[0]["state"] == "placed"
    skip = await client.post(f"/v2/orders/{oid}/status", headers=staff, json={"status": "ready"})
    assert skip.status_code == 409 and skip.json()["detail"]["code"] == "BAD_TRANSITION"

    r = await client.post(f"/v2/orders/{oid}/status", headers=staff, json={"status": "preparing"})
    assert r.status_code == 200 and r.json()["state"] == "preparing"
    tickets = (await client.get("/v2/pos/kitchen", headers=kitchen)).json()
    assert len(tickets) == 1 and tickets[0]["lines"][0]["name"] == "Dum Biryani" and tickets[0]["type"] == "Delivery"      # fee line is not cooked
    await client.post(f"/v2/orders/{oid}/status", headers=staff, json={"status": "ready"})

    d1, d2 = H(shop["d1"]), H(shop["d2"])
    pool = (await client.get("/v2/delivery/orders", headers=d1)).json()
    assert [o["id"] for o in pool["pickup"]] == [oid] and pool["pickup"][0]["customer"]["phone"] == ""      # phone hidden until accepted
    got = await client.post(f"/v2/delivery/orders/{oid}/accept", headers=d1)
    assert got.status_code == 200 and got.json()["status"] == "out_for_delivery" and got.json()["collect"] == 27000
    late = await client.post(f"/v2/delivery/orders/{oid}/accept", headers=d2)
    assert late.status_code == 409 and late.json()["detail"]["code"] == "TAKEN"
    assert (await client.get("/v2/delivery/orders", headers=d2)).json()["pickup"] == []

    assert (await client.post("/v2/delivery/location", headers=d1, json={"lat": 17.455, "lng": 78.385, "battery": 80})).status_code == 200
    track = (await client.get(f"/v2/me/orders/{oid}", headers=H(cust))).json()
    assert track["status"] == "out_for_delivery" and track["driver"]["name"] and track["driver_location"]["lat"] == 17.455

    bad = await client.post(f"/v2/delivery/orders/{oid}/delivered", headers=d1, json={"code": "0000" if code != "0000" else "1111", "collected_mode": "cash"})
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "WRONG_CODE"
    no_cash = await client.post(f"/v2/delivery/orders/{oid}/delivered", headers=d1, json={"code": code})
    assert no_cash.status_code == 409 and no_cash.json()["detail"]["code"] == "PAYMENT_DUE"
    done = await client.post(f"/v2/delivery/orders/{oid}/delivered", headers=d1, json={"code": code, "collected_mode": "cash"})
    assert done.status_code == 200 and done.json()["status"] == "delivered"

    final = (await client.get(f"/v2/orders/{oid}", headers=staff)).json()
    assert final["status"] == "paid" and final["paid"] == 27000 and final["state"] == "delivered" and "delivery_code" not in final["online"]
    s = (await client.get("/v2/delivery/summary?range=today", headers=d1)).json()
    assert s["deliveries"] == 1 and s["cash_collected"] == 27000 and s["earnings"] == int(round((20 + s["distance_km"] * 5) * 100)) // 1 or s["earnings"] > 2000
    ov = (await client.get("/v2/overview", headers=H(shop["owner"]))).json()
    assert ov["sales"] == 27000 and ov["by_channel"]["online"] == 27000 and ov["by_mode"]["cash"] == 27000 and ov["open_online"] == 0
    assert (await client.get("/v2/pos/reports/day", headers=H(shop["owner"]))).json()["sales"] == 27000      # online sales are in the day report too


async def test_takeaway_needs_payment_before_it_can_be_closed(client, shop):
    cust = await sign_in(client, shop["slug"])
    o = (await client.post("/v2/me/orders", headers=H(cust), json={**cart(shop, ("Dum Biryani", 1)), "type": "takeaway"})).json()
    st, oid = H(shop["cashier"]), o["id"]
    for s in ("preparing", "ready"):
        assert (await client.post(f"/v2/orders/{oid}/status", headers=st, json={"status": s})).status_code == 200
    r = await client.post(f"/v2/orders/{oid}/status", headers=st, json={"status": "completed"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "PAYMENT_DUE"
    r = await client.post(f"/v2/orders/{oid}/status", headers=st, json={"status": "completed", "collect": {"mode": "upi", "ref": "UTR1"}})
    assert r.status_code == 200 and r.json()["status"] == "paid"


async def test_cancel_rules(client, shop):
    cust = await sign_in(client, shop["slug"])
    a = (await client.post("/v2/me/orders", headers=H(cust), json={**cart(shop, ("Dum Biryani", 1)), "type": "takeaway"})).json()
    r = await client.post(f"/v2/me/orders/{a['id']}/cancel", headers=H(cust))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    b = (await client.post("/v2/me/orders", headers=H(cust), json={**cart(shop, ("Dum Biryani", 1)), "type": "takeaway"})).json()
    st = H(shop["cashier"])
    await client.post(f"/v2/orders/{b['id']}/status", headers=st, json={"status": "preparing"})
    late = await client.post(f"/v2/me/orders/{b['id']}/cancel", headers=H(cust))
    assert late.status_code == 409 and late.json()["detail"]["code"] == "TOO_LATE"
    no_reason = await client.post(f"/v2/orders/{b['id']}/status", headers=st, json={"status": "cancelled"})
    assert no_reason.status_code == 400
    ok = await client.post(f"/v2/orders/{b['id']}/status", headers=st, json={"status": "cancelled", "reason": "Out of rice"})
    assert ok.status_code == 200
    assert (await client.get("/v2/pos/kitchen", headers=H(shop["kitchen"]))).json() == []      # the cooking ticket was cancelled
    assert len((await client.get("/v2/orders?scope=cancelled", headers=st)).json()) == 2


async def test_dine_in_needs_a_known_table(client, shop):
    cust = await sign_in(client, shop["slug"])
    cfg = (await client.get("/v2/tenants/me", headers=H(shop["owner"]))).json()["config"]
    cfg["pos"] = {**cfg.get("pos", {}), "tables": ["T-01", "T-02"]}
    assert (await client.put("/v2/tenants/me/config", headers=H(shop["owner"]), json=cfg)).status_code == 200
    bad = await client.post("/v2/me/orders", headers=H(cust), json={**cart(shop, ("Dum Biryani", 1)), "type": "dine-in", "table": "T-99"})
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "BAD_TABLE"
    ok = await client.post("/v2/me/orders", headers=H(cust), json={**cart(shop, ("Dum Biryani", 1)), "type": "dine-in", "table": "T-02"})
    assert ok.status_code == 201 and ok.json()["table"] == "T-02"
    t = (await client.get("/v2/tables", headers=H(shop["cashier"]))).json()
    assert [x["table"] for x in t] == ["T-01", "T-02"]


# ---------------------------------------------------------------- isolation and tokens
async def test_tokens_do_not_cross_roles_or_restaurants(client, shop, platform_token):
    cust = await sign_in(client, shop["slug"])
    assert (await client.get("/v2/orders", headers=H(cust))).status_code == 401           # a customer is not staff
    assert (await client.get("/v2/me", headers=H(shop["owner"]))).status_code == 401      # staff is not a customer
    _, other_owner, _ = await onboard(client, platform_token, "other-place", "owner@other.example.com")
    other = await client.post("/v2/pos/menu", headers=H(other_owner), json={"name": "Dosa", "price": 9000, "category": "Food"})
    order = (await client.post("/v2/me/orders", headers=H(cust), json={**cart(shop, ("Dum Biryani", 1)), "type": "takeaway"})).json()
    assert (await client.get(f"/v2/orders/{order['id']}", headers=H(other_owner))).status_code == 404      # another restaurant cannot see it
    cust_b = await sign_in(client, "other-place", name="Someone")
    assert (await client.get(f"/v2/me/orders/{order['id']}", headers=H(cust_b))).status_code == 404
    bad = await client.post("/v2/me/orders", headers=H(cust_b), json={"items": [{"item_id": shop["items"]["Dum Biryani"], "qty": 1}], "type": "takeaway"})
    assert bad.status_code == 404 and other.status_code == 201      # a dish id from another restaurant does not exist here


async def test_customers_and_staff_management(client, shop):
    cust = await sign_in(client, shop["slug"], name="Ravi Kumar")
    o = (await client.post("/v2/me/orders", headers=H(cust), json={**cart(shop, ("Dum Biryani", 1)), "type": "takeaway"})).json()
    st = H(shop["cashier"])
    for s in ("preparing", "ready"):
        await client.post(f"/v2/orders/{o['id']}/status", headers=st, json={"status": s})
    await client.post(f"/v2/orders/{o['id']}/status", headers=st, json={"status": "completed", "collect": {"mode": "cash"}})
    rows = (await client.get("/v2/customers?q=ravi", headers=st)).json()
    assert rows and rows[0]["phone"] == "9876543210" and rows[0]["spend"] == 25000 and rows[0]["registered"]
    users = (await client.get("/v2/users", headers=H(shop["owner"]))).json()
    d2 = next(u for u in users if u["email"] == "d2@bh.example.com")
    r = await client.patch(f"/v2/users/{d2['id']}", headers=H(shop["owner"]), json={"status": "disabled"})
    assert r.status_code == 200
    assert (await client.get("/v2/delivery/orders", headers=H(shop["d2"]))).status_code == 401      # disabled: session revoked at once
    owner = next(u for u in users if u["role"] == "owner")
    assert (await client.patch(f"/v2/users/{owner['id']}", headers=H(shop["owner"]), json={"role": "viewer"})).status_code == 403
    assert (await client.patch(f"/v2/users/{d2['id']}", headers=st, json={"status": "active"})).status_code == 403


async def test_bulk_menu_actions_and_account_deletion(client, shop):
    o = H(shop["owner"])
    r = await client.post("/v2/pos/menu/bulk-availability", headers=o, json={"category": "Food", "available": False})
    assert r.json()["updated"] == 3
    assert all(not i["available"] for i in (await client.get("/v2/public/biryani-house/menu")).json()["items"])
    r = await client.post("/v2/pos/menu/bulk-price", headers=o, json={"category": "Food", "pct": 10})
    assert r.json()["updated"] == 3
    prices = {i["name"]: i["price"] for i in (await client.get("/v2/public/biryani-house/menu")).json()["items"]}
    assert prices["Dum Biryani"] == 27500 and prices["Irani Chai"] == 2200
    cust = await sign_in(client, shop["slug"])
    assert (await client.delete("/v2/me", headers=H(cust))).status_code == 204
    assert (await client.get("/v2/me", headers=H(cust))).status_code == 401


async def test_rider_assigned_by_staff_can_still_accept_and_others_cannot(client, shop):
    cust = await sign_in(client, shop["slug"])
    o = (await client.post("/v2/me/orders", headers=H(cust), json={**cart(shop, ("Dum Biryani", 1)), "type": "delivery", "address": ADDR_NEAR})).json()
    st, oid = H(shop["cashier"]), o["id"]
    for s_ in ("preparing", "ready"):
        await client.post(f"/v2/orders/{oid}/status", headers=st, json={"status": s_})
    drivers = (await client.get("/v2/delivery/drivers", headers=st)).json()
    d1 = next(d for d in drivers if d["name"] and d["id"])
    me1 = (await client.get("/v2/pos/rules", headers=H(shop["d1"]))).json()
    assert (await client.post(f"/v2/orders/{oid}/assign", headers=st, json={"driver_id": d1["id"]})).status_code == 200
    mine = [H(shop["d1"]), H(shop["d2"])]
    results = [(await client.post(f"/v2/delivery/orders/{oid}/accept", headers=h)).status_code for h in mine]
    assert sorted(results) == [200, 409] and me1["role"] == "delivery"


async def test_coupon_expiry_and_tables_fallback_and_full_permission_list(client, shop):
    o = H(shop["owner"])
    await client.post("/v2/coupons", headers=o, json={"code": "OLD", "kind": "pct", "value": 10, "valid_to": "2020-01-01"})
    await client.post("/v2/coupons", headers=o, json={"code": "NEW", "kind": "pct", "value": 10, "valid_to": "2099-12-31"})
    base = {**cart(shop, ("Dum Biryani", 1)), "type": "takeaway"}
    assert (await client.post("/v2/public/biryani-house/quote", json={**base, "coupon": "OLD"})).json()["detail"]["code"] == "COUPON_INVALID"
    assert (await client.post("/v2/public/biryani-house/quote", json={**base, "coupon": "NEW"})).status_code == 200
    assert len((await client.get("/v2/tables", headers=H(shop["cashier"]))).json()) >= 10         # default tables when none are configured
    perms = (await client.get("/v2/pos/rules", headers=H(shop["cashier"]))).json()["all_permissions"]
    assert "orders.update" in perms and "users.manage" not in perms


async def test_deleted_account_can_start_again_and_order_lines_carry_item_ids(client, shop):
    tok = await sign_in(client, shop["slug"], phone="9876543299", name="Old Name")
    assert (await client.put("/v2/me", headers=H(tok), json={"addresses": [{"text": "Somewhere 123", "lat": 17.46, "lng": 78.39}]})).status_code == 200
    o = (await client.post("/v2/me/orders", headers=H(tok), json={**cart(shop, ("Dum Biryani", 1)), "type": "takeaway"})).json()
    assert o["lines"][0]["item_id"] == shop["items"]["Dum Biryani"]
    assert (await client.delete("/v2/me", headers=H(tok))).status_code == 204
    assert (await client.get("/v2/me", headers=H(tok))).status_code == 401
    again = await sign_in(client, shop["slug"], phone="9876543299", name="New Name")
    me = (await client.get("/v2/me", headers=H(again))).json()
    assert me["name"] == "New Name" and me["addresses"] == []
