"""Counter flows end to end: bills, notes, split, KOT, payment, approvals, refunds, printing, role rules, isolation."""
import base64
import copy

import pytest

from nova.billing import calc
from nova.printing.escpos import PROFILES, EscPos, ascii_safe

from .conftest import PW, onboard

# ---------------------------------------------------------------- helpers
H = lambda t: {"Authorization": f"Bearer {t}"}  # noqa: E731


async def make_user(client, owner_tok, slug, email, role):
    r = await client.post("/v2/users", headers=H(owner_tok), json={"email": email, "role": role, "name": role.title()})
    assert r.status_code == 201, r.text
    await client.post("/v2/auth/accept-invite", json={"tenant": slug, "token": r.json()["invite_token"], "password": PW})
    r = await client.post("/v2/auth/login", json={"tenant": slug, "email": email, "password": PW})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def set_pin(client, tok, pin):
    r = await client.put("/v2/pos/me/pin", headers=H(tok), json={"pin": pin, "password": PW})
    assert r.status_code == 204, r.text


@pytest.fixture
async def shop(client, platform_token):
    tid, owner, _ = await onboard(client, platform_token, "shop", "owner@shop.example.com")
    cashier = await make_user(client, owner, "shop", "cash@shop.example.com", "cashier")
    manager = await make_user(client, owner, "shop", "mgr@shop.example.com", "manager")
    await set_pin(client, manager, "4826")
    await set_pin(client, owner, "7391")
    items = {}
    menu = [("Hyderabadi Biryani", 52000, 101, "kitchen"), ("Irani Chai", 4000, 501, "beverage"), ("Garlic Naan", 7000, 401, "kitchen")]
    for name, price, code, station in menu:
        r = await client.post("/v2/pos/menu", headers=H(owner), json={"name": name, "price": price, "category": "All", "code": code, "station": station})
        assert r.status_code == 201, r.text
        items[name] = r.json()["id"]
    return {"tid": tid, "owner": owner, "cashier": cashier, "manager": manager, "items": items}


async def new_bill(client, tok, **kw):
    r = await client.post("/v2/pos/bills", headers=H(tok), json={"type": "Dine-in", "table": "T-04", **kw})
    assert r.status_code == 201, r.text
    return r.json()


async def add(client, tok, bill, item, qty=1, note=""):
    r = await client.post(f"/v2/pos/bills/{bill['id']}/lines", headers=H(tok), json={"item_id": item, "qty": qty, "note": note})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- arithmetic
def test_tax_inclusive_and_exclusive_are_exact():
    lines = [{"price": 52000, "qty": 2}, {"price": 4000, "qty": 3}]
    inc = calc.compute(lines, None, 0.05, "inclusive")
    assert inc.subtotal == 116000 and inc.total == 116000
    assert inc.tax == sum(x["tax"] for x in inc.lines) and 5500 < inc.tax < 5600
    exc = calc.compute(lines, None, 0.05, "exclusive")
    assert exc.total == exc.subtotal + exc.tax


def test_discount_is_shared_exactly_across_lines():
    lines = [{"price": 3333, "qty": 1}, {"price": 3333, "qty": 1}, {"price": 3334, "qty": 1}]
    t = calc.compute(lines, {"kind": "pct", "value": 10}, 0.05, "inclusive")
    assert t.discount == 1000 and sum(x["discount"] for x in t.lines) == 1000
    assert t.total == 10000 - 1000


def test_amount_discount_never_exceeds_the_bill():
    assert calc.discount_amount(5000, {"kind": "amount", "value": 99999}) == 5000


# ---------------------------------------------------------------- happy path
async def test_bill_with_notes_kot_kitchen_pay_and_print(client, shop):
    c, t, it = client, shop["cashier"], shop["items"]
    b = await new_bill(c, t)
    b = await add(c, t, b, it["Hyderabadi Biryani"], 2, "less spicy")
    b = await add(c, t, b, it["Hyderabadi Biryani"], 1, "")          # different note, separate line
    b = await add(c, t, b, it["Irani Chai"], 2)
    assert len(b["lines"]) == 3 and b["totals"]["total"] == 3 * 52000 + 2 * 4000

    r = await c.post(f"/v2/pos/bills/{b['id']}/kot", headers=H(t))
    assert r.status_code == 200, r.text
    assert len(r.json()["prints"]) == 2                                  # kitchen + beverage stations
    kot_bytes = b"".join(base64.b64decode(p["data"]) for p in r.json()["prints"])
    assert b"less spicy" in kot_bytes
    r2 = await c.post(f"/v2/pos/bills/{b['id']}/kot", headers=H(t))
    assert r2.status_code == 400 and r2.json()["detail"]["code"] == "NOTHING_NEW"

    tickets = (await c.get("/v2/pos/kitchen", headers=H(shop["owner"]))).json()
    assert {x["station"] for x in tickets} == {"kitchen", "beverage"}
    r = await c.post(f"/v2/pos/kitchen/{tickets[0]['id']}/advance", headers=H(shop["owner"]))
    assert r.json()["status"] == "cooking"

    total = b["totals"]["total"]
    r = await c.post(f"/v2/pos/bills/{b['id']}/pay", headers=H(t), json={"payments": [{"mode": "cash", "amount": total + 5000}]}, )
    assert r.status_code == 200, r.text
    paid = r.json()
    assert paid["status"] == "paid" and paid["balance"] == 0 and paid["payments"][0]["change"] == 5000

    r = await c.post(f"/v2/pos/bills/{b['id']}/lines", headers=H(t), json={"item_id": it["Irani Chai"], "qty": 1})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "BILL_CLOSED"

    r = await c.post(f"/v2/pos/bills/{b['id']}/print", headers=H(t), json={})
    data = base64.b64decode(r.json()["data"])
    assert data.startswith(b"\x1b@") and b"Rs" in data and b"less spicy" in data and b"DUPLICATE" not in data


async def test_paying_twice_with_the_same_key_collects_once(client, shop):
    c, t = client, shop["cashier"]
    b = await add(c, t, await new_bill(c, t), shop["items"]["Irani Chai"], 1)
    body = {"payments": [{"mode": "upi", "amount": 4000, "ref": "UTR1"}]}
    k = {**H(t), "Idempotency-Key": "tap-1"}
    assert (await c.post(f"/v2/pos/bills/{b['id']}/pay", headers=k, json=body)).status_code == 200
    r = await c.post(f"/v2/pos/bills/{b['id']}/pay", headers=k, json=body)      # double tap / network retry
    assert r.status_code == 200 and len(r.json()["payments"]) == 1


async def test_split_payments_cash_plus_upi(client, shop):
    c, t = client, shop["cashier"]
    b = await add(c, t, await new_bill(c, t), shop["items"]["Hyderabadi Biryani"], 1)
    r = await c.post(f"/v2/pos/bills/{b['id']}/pay", headers=H(t), json={"payments": [{"mode": "cash", "amount": 20000}, {"mode": "upi", "amount": 32000}]})
    assert r.json()["status"] == "paid" and len(r.json()["payments"]) == 2
    r = await c.post(f"/v2/pos/bills/{b['id']}/pay", headers=H(t), json={"payments": [{"mode": "upi", "amount": 100}]})
    assert r.status_code == 409


async def test_split_bill_moves_items_and_keeps_totals(client, shop):
    c, t, it = client, shop["cashier"], shop["items"]
    b = await add(c, t, await new_bill(c, t), it["Hyderabadi Biryani"], 3)
    b = await add(c, t, b, it["Irani Chai"], 2)
    before = b["totals"]["total"]
    biryani = next(x for x in b["lines"] if x["name"].startswith("Hyd"))
    r = await c.post(f"/v2/pos/bills/{b['id']}/split", headers=H(t), json={"picks": [{"lid": biryani["lid"], "qty": 1}]})
    assert r.status_code == 200, r.text
    a, n = r.json()["bill"], r.json()["new_bill"]
    assert a["totals"]["total"] + n["totals"]["total"] == before and n["split_from"] == a["bill_no"]
    r = await c.post(f"/v2/pos/bills/{b['id']}/split", headers=H(t), json={"picks": [{"lid": biryani["lid"], "qty": 9}]})
    assert r.status_code == 400


# ---------------------------------------------------------------- rules and approvals
async def test_cashier_discount_limit_and_manager_pin_approval(client, shop):
    c, t = client, shop["cashier"]
    b = await add(c, t, await new_bill(c, t), shop["items"]["Hyderabadi Biryani"], 2)
    ok = await c.put(f"/v2/pos/bills/{b['id']}/discount", headers=H(t), json={"kind": "pct", "value": 10})
    assert ok.status_code == 200 and ok.json()["totals"]["discount"] == 10400
    r = await c.put(f"/v2/pos/bills/{b['id']}/discount", headers=H(t), json={"kind": "pct", "value": 25})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "APPROVAL_REQUIRED"

    bad = await c.post("/v2/pos/approvals", headers=H(t), json={"pin": "0000", "permission": "bills.discount.override", "bill_id": b["id"]})
    assert bad.status_code == 403
    r = await c.post("/v2/pos/approvals", headers=H(t), json={"pin": "4826", "permission": "bills.discount.override", "bill_id": b["id"]})
    assert r.status_code == 200, r.text
    tok = r.json()["approval_token"]
    r = await c.put(f"/v2/pos/bills/{b['id']}/discount", headers=H(t), json={"kind": "pct", "value": 25, "approval_token": tok})
    assert r.status_code == 200 and r.json()["discount"]["by"].endswith("(approved by mgr@shop.example.com)")
    again = await c.put(f"/v2/pos/bills/{b['id']}/discount", headers=H(t), json={"kind": "pct", "value": 26, "approval_token": tok})
    assert again.status_code == 403 and again.json()["detail"]["code"] == "APPROVAL_USED"


async def test_wrong_pins_lock_the_requester_out(client, shop):
    t = shop["cashier"]
    for _ in range(5):
        assert (await client.post("/v2/pos/approvals", headers=H(t), json={"pin": "9999", "permission": "bills.refund"})).status_code == 403
    r = await client.post("/v2/pos/approvals", headers=H(t), json={"pin": "4826", "permission": "bills.refund"})   # even the right PIN is refused now
    assert r.status_code == 429


async def test_approval_is_bound_to_one_permission_and_one_person(client, shop):
    c, t = client, shop["cashier"]
    b = await add(c, t, await new_bill(c, t), shop["items"]["Irani Chai"], 1)
    tok = (await c.post("/v2/pos/approvals", headers=H(t), json={"pin": "4826", "permission": "bills.refund"})).json()["approval_token"]
    r = await c.put(f"/v2/pos/bills/{b['id']}/discount", headers=H(t), json={"kind": "pct", "value": 50, "approval_token": tok})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "APPROVAL_INVALID"        # refund approval cannot buy a discount
    other = await make_user(c, shop["owner"], "shop", "cash2@shop.example.com", "cashier")
    r = await c.put(f"/v2/pos/bills/{b['id']}/discount", headers=H(other), json={"kind": "pct", "value": 40, "approval_token": tok})
    assert r.status_code in (403, 404)                                                       # someone else cannot borrow it


async def test_void_item_after_kot_needs_a_manager_and_a_reason(client, shop):
    c, t = client, shop["cashier"]
    b = await add(c, t, await new_bill(c, t), shop["items"]["Hyderabadi Biryani"], 2)
    await c.post(f"/v2/pos/bills/{b['id']}/kot", headers=H(t))
    lid = b["lines"][0]["lid"]
    r = await c.patch(f"/v2/pos/bills/{b['id']}/lines/{lid}", headers=H(t), json={"qty": 1})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "APPROVAL_REQUIRED"
    tok = (await c.post("/v2/pos/approvals", headers=H(t), json={"pin": "4826", "permission": "bills.void_item", "bill_id": b["id"]})).json()["approval_token"]
    r = await c.patch(f"/v2/pos/bills/{b['id']}/lines/{lid}", headers=H(t), json={"qty": 1, "approval_token": tok})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "REASON_REQUIRED"
    tok = (await c.post("/v2/pos/approvals", headers=H(t), json={"pin": "4826", "permission": "bills.void_item", "bill_id": b["id"]})).json()["approval_token"]
    r = await c.patch(f"/v2/pos/bills/{b['id']}/lines/{lid}", headers=H(t), json={"qty": 1, "approval_token": tok, "reason": "guest changed mind"})
    assert r.status_code == 200 and r.json()["lines"][0]["qty"] == 1
    audit = (await c.get("/v2/audit", headers=H(shop["owner"]))).json()
    assert any(a["action"] == "bill.void_item" and "approved by" in a["actor"] for a in audit)


async def test_refund_limit_reopen_and_audit(client, shop):
    c, t, m, o = client, shop["cashier"], shop["manager"], shop["owner"]
    b = await add(c, t, await new_bill(c, t), shop["items"]["Hyderabadi Biryani"], 5)       # ₹2,600
    await c.post(f"/v2/pos/bills/{b['id']}/pay", headers=H(t), json={"payments": [{"mode": "cash", "amount": 260000}]})
    r = await c.post(f"/v2/pos/bills/{b['id']}/refund", headers=H(t), json={"amount": 1000, "mode": "cash", "reason": "x"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "APPROVAL_REQUIRED"        # cashier has no refund right
    r = await c.post(f"/v2/pos/bills/{b['id']}/refund", headers=H(m), json={"amount": 250000, "mode": "cash", "reason": "wrong order"})
    assert r.status_code == 403                                                              # above the manager's ₹2,000 limit
    r = await c.post(f"/v2/pos/bills/{b['id']}/refund", headers=H(m), json={"amount": 100000, "mode": "cash"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "REASON_REQUIRED"
    r = await c.post(f"/v2/pos/bills/{b['id']}/refund", headers=H(m), json={"amount": 100000, "mode": "cash", "reason": "cold food"})
    assert r.status_code == 200 and r.json()["paid"] == 160000
    r = await c.post(f"/v2/pos/bills/{b['id']}/refund", headers=H(o), json={"amount": 160000, "mode": "cash", "reason": "owner decision"})
    assert r.json()["status"] == "refunded"

    b2 = await add(c, t, await new_bill(c, t), shop["items"]["Irani Chai"], 2)
    await c.post(f"/v2/pos/bills/{b2['id']}/pay", headers=H(t), json={"payments": [{"mode": "cash", "amount": 8000}]})
    assert (await c.post(f"/v2/pos/bills/{b2['id']}/reopen", headers=H(t), json={"reason": "add item"})).status_code == 403
    r = await c.post(f"/v2/pos/bills/{b2['id']}/reopen", headers=H(m), json={"reason": "customer added a chai"})
    assert r.status_code == 200 and r.json()["status"] == "open"
    b2 = await add(c, m, b2, shop["items"]["Irani Chai"], 1)
    assert b2["balance"] == 4000
    r = await c.post(f"/v2/pos/bills/{b2['id']}/pay", headers=H(m), json={"payments": [{"mode": "upi", "amount": 4000}]})
    assert r.json()["status"] == "paid"


async def test_void_unpaid_bill_cancels_kitchen_tickets(client, shop):
    c, t = client, shop["cashier"]
    b = await add(c, t, await new_bill(c, t), shop["items"]["Hyderabadi Biryani"], 1)
    await c.post(f"/v2/pos/bills/{b['id']}/kot", headers=H(t))
    r = await c.post(f"/v2/pos/bills/{b['id']}/void", headers=H(t), json={"reason": "walked out"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "APPROVAL_REQUIRED"
    r = await c.post(f"/v2/pos/bills/{b['id']}/void", headers=H(shop["manager"]), json={"reason": "walked out"})
    assert r.status_code == 200 and r.json()["status"] == "void"
    assert (await c.get("/v2/pos/kitchen", headers=H(shop["owner"]))).json() == []


async def test_reprint_is_a_separate_right_and_marked_duplicate(client, shop):
    c, t = client, shop["cashier"]
    b = await add(c, t, await new_bill(c, t), shop["items"]["Irani Chai"], 1)
    await c.post(f"/v2/pos/bills/{b['id']}/pay", headers=H(t), json={"payments": [{"mode": "cash", "amount": 4000}]})
    assert (await c.post(f"/v2/pos/bills/{b['id']}/print", headers=H(t), json={})).status_code == 200
    r = await c.post(f"/v2/pos/bills/{b['id']}/print", headers=H(t), json={})
    assert r.status_code == 403
    r = await c.post(f"/v2/pos/bills/{b['id']}/print", headers=H(shop["manager"]), json={})
    assert r.status_code == 200 and r.json()["duplicate"] and b"DUPLICATE" in base64.b64decode(r.json()["data"])


async def test_stale_screen_cannot_overwrite_a_newer_bill(client, shop):
    c, t = client, shop["cashier"]
    b = await add(c, t, await new_bill(c, t), shop["items"]["Irani Chai"], 1)
    r = await c.post(f"/v2/pos/bills/{b['id']}/lines", headers=H(t), json={"item_id": shop["items"]["Garlic Naan"], "qty": 1, "revision": b["revision"] - 1})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "STALE_BILL"


# ---------------------------------------------------------------- tenant rules + isolation
async def test_owner_can_tighten_and_loosen_roles_per_restaurant(client, shop):
    c, o, t = client, shop["owner"], shop["cashier"]
    cfg = (await c.get("/v2/tenants/me", headers=H(o))).json()["config"]
    new = copy.deepcopy(cfg)
    new["pos"] = {"roles": {"cashier": {"revoke": ["bills.discount"], "grant": ["bills.reprint"]}}, "limits": {"discount_max_pct": {"manager": 5}}}
    r = await c.put("/v2/tenants/me/config", headers=H(o), json=new)
    assert r.status_code == 200, r.text
    b = await add(c, t, await new_bill(c, t), shop["items"]["Irani Chai"], 1)
    r = await c.put(f"/v2/pos/bills/{b['id']}/discount", headers=H(t), json={"kind": "pct", "value": 5})
    assert r.status_code == 403                                                           # revoked for cashiers here
    rules = (await c.get("/v2/pos/rules", headers=H(t))).json()
    assert "bills.reprint" in rules["permissions"] and "bills.discount" not in rules["permissions"]
    mgr = (await c.get("/v2/pos/rules", headers=H(shop["manager"]))).json()
    assert mgr["limits"]["discount_max_pct"] == 5


async def test_config_cannot_grant_non_pos_permissions(client, shop):
    cfg = (await client.get("/v2/tenants/me", headers=H(shop["owner"]))).json()["config"]
    bad = copy.deepcopy(cfg)
    bad["pos"] = {"roles": {"cashier": {"grant": ["users.manage"]}}}
    assert (await client.put("/v2/tenants/me/config", headers=H(shop["owner"]), json=bad)).status_code in (400, 422)
    dup = copy.deepcopy(cfg)
    one = {"id": "a", "name": "x", "profile": "tvs-rp3200", "for": ["receipt"]}
    dup["pos"] = {"printers": [one, {**one, "name": "y", "profile": "generic-58", "for": ["kot"]}]}
    assert (await client.put("/v2/tenants/me/config", headers=H(shop["owner"]), json=dup)).status_code in (400, 422)


async def test_other_restaurants_never_see_these_bills(client, platform_token, shop):
    _, other, _ = await onboard(client, platform_token, "rival", "owner@rival.example.com")
    b = await add(client, shop["cashier"], await new_bill(client, shop["cashier"]), shop["items"]["Irani Chai"], 1)
    assert (await client.get(f"/v2/pos/bills/{b['id']}", headers=H(other))).status_code == 404
    assert (await client.get("/v2/pos/bills", headers=H(other))).json() == []
    assert (await client.get("/v2/pos/menu", headers=H(other))).json() == []


async def test_end_of_day_summary(client, shop):
    c, t = client, shop["cashier"]
    b = await add(c, t, await new_bill(c, t), shop["items"]["Hyderabadi Biryani"], 1)
    await c.post(f"/v2/pos/bills/{b['id']}/pay", headers=H(t), json={"payments": [{"mode": "cash", "amount": 30000}, {"mode": "upi", "amount": 22000}]})
    r = await c.get("/v2/pos/reports/day", headers=H(shop["manager"]))
    assert r.status_code == 200 and r.json()["sales"] == 52000 and r.json()["by_mode"] == {"cash": 30000, "upi": 22000}
    assert (await c.get("/v2/pos/reports/day", headers=H(t))).status_code == 403


# ---------------------------------------------------------------- printing bytes
def test_text_is_made_printable_on_a_thermal_printer():
    assert ascii_safe("₹520 – Café “special”") == 'Rs520 - Cafe "special"'
    assert ascii_safe("తెలుగు").replace("?", "") == ""


def test_columns_follow_the_paper_width():
    e = EscPos(PROFILES["generic-58"])
    e.row("2 x Hyderabadi Biryani Special Family Pack", "1,040")
    out = e.build().split(b"\n")[0].split(b"@")[-1]
    assert len(out.decode("ascii", "ignore").rstrip()) <= 32
    e80 = EscPos(PROFILES["tvs-rp3200"])
    assert e80.cols == 48 and len(e80.wrap("word " * 40)[0]) <= 48


def test_printer_setup_and_test_slip(client_sync=None):
    from nova.printing.render import printer_for, test_slip
    cfg = {"brand": {"name": "Hyderabadi Irani"}, "pos": {"printers": [
        {"id": "counter", "name": "Counter", "profile": "tvs-rp3200", "for": ["receipt"], "cash_drawer": True},
        {"id": "bar", "name": "Bar", "profile": "generic-58", "for": ["kot"], "station": "beverage"}]}}
    assert printer_for(cfg, "receipt")["id"] == "counter"
    assert printer_for(cfg, "kot", station="beverage")["id"] == "bar"
    assert printer_for({"pos": {}}, "kot")["profile"] == "tvs-rp3200"                    # works with no setup at all
    assert b"Hyderabadi Irani" in test_slip(cfg, cfg["pos"]["printers"][0])
