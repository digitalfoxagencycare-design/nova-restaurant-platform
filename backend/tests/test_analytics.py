"""Drill-down analytics: every figure can be split, filtered down to the bills behind it, and opened in full."""

import pytest

from .conftest import onboard
from .test_pos import H, add, make_user, new_bill


@pytest.fixture
async def busy(client, platform_token):
    """One restaurant with a few paid bills of different kinds."""
    tid, owner, _ = await onboard(client, platform_token, "busy", "owner@busy.example.com")
    cashier = await make_user(client, owner, "busy", "cash@busy.example.com", "cashier")
    ids = {}
    for name, price, code, station in [("Biryani", 50000, 1, "kitchen"), ("Chai", 4000, 2, "beverage")]:
        r = await client.post(
            "/v2/pos/menu",
            headers=H(owner),
            json={"name": name, "price": price, "category": "Main" if name == "Biryani" else "Drinks", "code": code, "station": station},
        )
        ids[name] = r.json()["id"]

    async def sale(btype, lines, mode):
        b = await new_bill(client, cashier, type=btype) if btype != "Dine-in" else await new_bill(client, cashier)
        for it, q in lines:
            b = await add(client, cashier, b, ids[it], q)
        r = await client.post(f"/v2/pos/bills/{b['id']}/pay", headers=H(cashier), json={"payments": [{"mode": mode, "amount": b["totals"]["total"]}]})
        assert r.status_code == 200, r.text
        return r.json()

    paid = [
        await sale("Dine-in", [("Biryani", 2)], "cash"),
        await sale("Dine-in", [("Chai", 3)], "upi"),
        await sale("Takeaway", [("Biryani", 1), ("Chai", 1)], "upi"),
    ]
    unpaid = await new_bill(client, cashier)
    await add(client, cashier, unpaid, ids["Chai"], 1)
    return {"tid": tid, "owner": owner, "cashier": cashier, "paid": paid}


async def get(client, tok, path, **params):
    r = await client.get(path, headers=H(tok), params=params)
    assert r.status_code == 200, r.text
    return r


async def test_breakdown_totals_match_the_bills(client, busy):
    d = (await get(client, busy["owner"], "/v2/analytics/breakdown", by="payment_mode")).json()
    want = sum(b["totals"]["total"] for b in busy["paid"])
    assert d["totals"]["orders"] == 3 and d["totals"]["sales"] == want  # the open bill is not a sale
    rows = {r["key"]: r for r in d["rows"]}
    assert set(rows) == {"cash", "upi"} and sum(r["sales"] for r in d["rows"]) == want
    assert abs(sum(r["share"] for r in d["rows"]) - 1) < 0.01
    assert "previous" in d


async def test_drill_down_filters_narrow_every_level(client, busy):
    o = busy["owner"]
    d = (await get(client, o, "/v2/analytics/breakdown", by="item", f=["payment_mode:upi"])).json()
    assert {r["key"] for r in d["rows"]} == {"Biryani", "Chai"} and d["totals"]["orders"] == 2
    d = (await get(client, o, "/v2/analytics/breakdown", by="item", f=["payment_mode:upi", "type:Takeaway"])).json()
    assert d["totals"]["orders"] == 1
    rec = (await get(client, o, "/v2/analytics/records", f=["payment_mode:upi", "item:Chai"])).json()
    assert rec["total_count"] == 2 and all("Chai" in " ".join(r["items"]) for r in rec["rows"])


async def test_days_are_filled_so_charts_have_no_holes(client, busy):
    d = (await get(client, busy["owner"], "/v2/analytics/breakdown", by="day", **{"from": "2020-01-01", "to": "2020-01-05"})).json()
    assert [r["key"] for r in d["rows"]] == [f"2020-01-0{i}" for i in range(1, 6)] and all(r["sales"] == 0 for r in d["rows"])


async def test_bad_input_is_refused_cleanly(client, busy):
    o = busy["owner"]
    for params in (
        {"by": "nonsense"},
        {"by": "restaurant"},
        {"scope": "x"},
        {"f": "colour:red"},
        {"f": "garbage"},
        {"from": "2020-01-01", "to": "2025-01-01"},
        {"from": "bad"},
    ):
        r = await client.get("/v2/analytics/breakdown", headers=H(o), params={"by": "day", **params})
        assert r.status_code in (400, 422), (params, r.status_code, r.text)


async def test_only_people_who_may_see_reports_can_open_them(client, busy):
    r = await client.get("/v2/analytics/breakdown", headers=H(busy["cashier"]))
    assert r.status_code == 403
    assert (await client.get("/v2/analytics/meta")).status_code in (401, 403)


async def test_one_restaurant_never_sees_anothers_bills(client, busy, platform_token):
    _, other, _ = await onboard(client, platform_token, "quiet", "owner@quiet.example.com")
    d = (await get(client, other, "/v2/analytics/breakdown", by="channel")).json()
    assert d["totals"]["orders"] == 0
    assert (await get(client, other, "/v2/analytics/records")).json()["total_count"] == 0


async def test_csv_has_one_row_per_bill_and_defuses_formulas(client, busy):
    r = await get(client, busy["owner"], "/v2/analytics/records.csv")
    assert r.headers["content-type"].startswith("text/csv") and "attachment" in r.headers["content-disposition"]
    assert len(r.text.strip().splitlines()) == 1 + 3
    from nova.api.routes_analytics import _safe

    assert _safe("=HYPERLINK(1)").startswith("'") and _safe("+1").startswith("'") and _safe("Ravi") == "Ravi"


async def test_platform_view_spans_restaurants_and_opens_a_bill(client, busy, platform_token):
    p = platform_token
    d = (await get(client, p, "/v2/platform/analytics/breakdown", by="restaurant")).json()
    assert [r["key"] for r in d["rows"]] == [busy["tid"]] or d["rows"][0]["sales"] > 0
    rec = (await get(client, p, "/v2/platform/analytics/records", f=[f"restaurant:{busy['tid']}"])).json()
    assert rec["total_count"] == 3 and rec["rows"][0]["restaurant"]
    row = rec["rows"][0]
    full = (await get(client, p, f"/v2/platform/analytics/bill/{row['restaurant_id']}/{row['id']}")).json()
    assert full["restaurant"] and full["id"] == row["id"]
    assert (await get(client, p, "/v2/platform/analytics/records.csv")).text.count("\n") >= 4
    # restaurant staff cannot use the platform routes
    assert (await client.get("/v2/platform/analytics/breakdown", headers=H(busy["owner"]))).status_code in (401, 403)
    assert (await client.get(f"/v2/platform/analytics/bill/nope/{row['id']}", headers=H(p))).status_code == 404
