#!/usr/bin/env python3
"""Local demo server: in-memory database, one seeded restaurant, fixed demo logins. DEVELOPMENT ONLY.

    python scripts/dev_server.py            # http://127.0.0.1:8000  (docs at /docs)

Seeds the restaurant `demo-biryani` with a menu, tables, an offer, staff of every role and two sample orders.
Sign-in codes are returned in the response (debug_otp) because nothing is sent. Refuses to run with ENV=production.
Data is lost when the process stops.
"""
from __future__ import annotations

import copy
import json
import os
import random
import secrets
import sys
from contextlib import asynccontextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import email_validator  # noqa: E402
import httpx  # noqa: E402
from cryptography.fernet import Fernet  # noqa: E402
import uvicorn  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

from nova.app import create_app  # noqa: E402
from nova.core.config import Settings  # noqa: E402
from nova.services import auth, online, payments  # noqa: E402
from nova.services import secrets as secrets_svc  # noqa: E402
from nova.services import tenants as tenant_svc  # noqa: E402
from nova.tenancy.db import PlatformDB, TenantDB  # noqa: E402

email_validator.TEST_ENVIRONMENT = True      # dev only: lets the reserved .test domain through the e-mail check
SLUG = "demo-biryani"
RZP_KEY_ID = "rzp_test_demo000000001"   # scan-secrets: allow
RZP_KEY = "dev-razorpay-key-0001"
RZP_HOOK = "dev-razorpay-hook-0001"
DEMO_PW = os.environ.get("DEMO_PW", "Demo-Pass-2026")
USERS = [("owner@demo.test", "owner", "Asha Owner"), ("manager@demo.test", "manager", "Manoj Manager"), ("cashier@demo.test", "cashier", "Charan Cashier"),
         ("kitchen@demo.test", "kitchen", "Kiran Kitchen"), ("rider@demo.test", "delivery", "Ravi Rider"), ("rider2@demo.test", "delivery", "Rahul Rider")]
MENU = [
    ("Chicken Dum Biryani", 28000, "Biryani", "kitchen", False, "Slow-cooked basmati with tender chicken"),
    ("Mutton Biryani", 36000, "Biryani", "kitchen", False, "Bone-in mutton, dum cooked"),
    ("Veg Biryani", 21000, "Biryani", "kitchen", True, "Seasonal vegetables and saffron rice"),
    ("Chicken 65", 22000, "Starters", "kitchen", False, "Crisp, spicy and curry-leaf tossed"),
    ("Paneer Tikka", 24000, "Starters", "kitchen", True, "Charred cottage cheese with mint chutney"),
    ("Butter Chicken", 30000, "Mains", "kitchen", False, "Silky tomato-cashew gravy"),
    ("Dal Makhani", 20000, "Mains", "kitchen", True, "Black lentils simmered overnight"),
    ("Garlic Naan", 6000, "Breads", "kitchen", True, "Tandoor baked"),
    ("Irani Chai", 2000, "Chai & Drinks", "beverage", True, "Classic Irani chai"),
    ("Fresh Lime Soda", 6000, "Chai & Drinks", "beverage", True, "Sweet, salted or mixed"),
    ("Double Ka Meetha", 14000, "Desserts", "kitchen", True, "Bread pudding with rabdi"),
    ("Osmania Biscuits (6)", 9000, "Bakery", "bakery", True, "Buttery and lightly sweet"),
]


class FakeOutside:
    """Stands in for Meta's WhatsApp API and for Razorpay so the whole product can be tried locally. Sent WhatsApp messages are printed."""

    def __init__(self):
        self.n = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        url, body = str(request.url), (json.loads(request.content) if request.content else {})
        if "graph.facebook.com" in url:
            t = body.get("template", {})
            params = [p.get("text") for c in t.get("components", []) for p in c.get("parameters", [])]
            print(f"  [WhatsApp -> {body.get('to')}] {t.get('name')}: {params}", flush=True)
            return httpx.Response(200, json={"messages": [{"id": "wamid.DEV"}]})
        if url.endswith("/v1/orders"):
            self.n += 1
            return httpx.Response(200, json={"id": f"order_DEV{self.n:05d}", "amount": body["amount"]})
        if "/refund" in url:
            print(f"  [Razorpay refund] {url.split('/')[-2]} amount={body.get('amount')}", flush=True)
            return httpx.Response(200, json={"id": "rfnd_DEV"})
        return httpx.Response(404, json={})


CUSTOMERS = [("9876510001", "Anita Rao"), ("9876510002", "Bhaskar Reddy"), ("9876510003", "Charitha N"), ("9876510004", "Dinesh Kumar"), ("9876510005", "Esha Sharma"),
             ("9876510006", "Farhan Ali"), ("9876510007", "Gayatri P"), ("9876510008", "Harish V"), ("9876510009", "Imran Khan"), ("9876510010", "Jyothi M"),
             ("9876510011", "Kiran Babu"), ("9876510012", "Lakshmi D"), ("9876510013", "Mohan Rao"), ("9876510014", "Nisha Verma"), ("9876510015", "Omkar S"),
             ("9876510016", "Priya Nair"), ("9876510017", "Qasim Syed"), ("9876510018", "Rekha T"), ("9876510019", "Suresh G"), ("9876510020", "Tarun J"),
             ("9876510021", "Uma Devi"), ("9876510022", "Vikram Singh"), ("9876510023", "Waseem A"), ("9876510024", "Yamini K")]
ADDRESSES = ["Flat 4B, Jubilee Hills Road 36", "Plot 88, Madhapur Main Road", "H.No 5-9-12, Banjara Hills Road 12", "Gachibowli, Lane 3 near DLF", "Kondapur, Botanical Garden Road"]
HOUR_WEIGHTS = {11: 2, 12: 7, 13: 10, 14: 6, 15: 2, 16: 1, 17: 2, 18: 3, 19: 8, 20: 11, 21: 9, 22: 5, 23: 1}
DAY_WEIGHTS = [0.85, 0.8, 0.85, 0.9, 1.15, 1.5, 1.45]       # Monday .. Sunday: weekends are busy


async def seed_history(tdb, cfg: dict, items: dict, rng, days: int, per_day: float, riders: list[dict], delivery: bool = True) -> int:
    """Insert paid/refunded/void bills for the last ``days`` days in the exact stored shape of services.billing / services.online."""
    from datetime import UTC, datetime, timedelta
    from zoneinfo import ZoneInfo

    from nova.billing import calc

    tz = ZoneInfo(cfg["locale"]["timezone"])
    now = datetime.now(UTC)
    rate, mode = float(cfg["tax"]["default_rate"]), cfg["tax"]["mode"]
    tables = (cfg.get("pos") or {}).get("tables") or []
    menu = [(name, doc) for name, doc in items.items()]
    weights = [doc["_w"] for _, doc in menu]
    hours, hw = list(HOUR_WEIGHTS), list(HOUR_WEIGHTS.values())
    seq = 0
    batch = []
    staff = ["cashier@demo.test", "manager@demo.test", "owner@demo.test"]
    for back in range(days, -1, -1):
        day = (now.astimezone(tz) - timedelta(days=back)).date()
        n = max(1, round(per_day * DAY_WEIGHTS[day.weekday()] * rng.uniform(0.75, 1.25)))
        stamps = []
        for _ in range(n):
            h = rng.choices(hours, hw)[0]
            stamps.append(datetime(day.year, day.month, day.day, h, rng.randrange(60), rng.randrange(60), tzinfo=tz))
        for local in sorted(stamps):
            ts = local.astimezone(UTC)
            if ts > now - timedelta(minutes=5):
                continue
            seq += 1
            online_ch = delivery and rng.random() < 0.30
            otype = rng.choices(["delivery", "takeaway", "dine-in"], [5, 3, 2])[0] if online_ch else rng.choices(["Dine-in", "Takeaway", "Delivery"], [62, 26, 12])[0]
            lines = []
            for _ in range(rng.choices([1, 2, 3, 4, 5], [2, 4, 4, 2, 1])[0]):
                name, doc = rng.choices(menu, weights)[0]
                qty = rng.choices([1, 2, 3, 4], [6, 4, 1, 1])[0]
                note = rng.choice(["", "", "", "", "less spicy", "extra raita", "no onion"])
                lines.append({"lid": uuid_hex(rng), "item_id": str(doc["_id"]), "name": name, "price": int(doc["price"]), "qty": qty, "note": note,
                              "station": doc.get("station", "kitchen"), "kot_qty": qty})
            food = sum(calc.line_value(ln) for ln in lines)
            is_delivery = otype.lower() == "delivery"
            if is_delivery and not riders:
                otype = "takeaway" if online_ch else "Takeaway"
                is_delivery = False
            km = round(rng.uniform(1, 7), 2) if is_delivery else None
            if is_delivery:
                lines.append({"lid": uuid_hex(rng), "item_id": "fee:delivery", "name": "Delivery fee", "price": 3000 + int((km or 0) * 600), "qty": 1, "note": "",
                              "station": "fee", "kot_qty": 1, "fee": True, "tax_rate": 0})
            cust = rng.choice(CUSTOMERS) if (online_ch or rng.random() < 0.45) else None
            discount, coupon, manual = None, None, False
            if online_ch and food >= 30000 and rng.random() < 0.28:
                amt = min(calc.discount_amount(food, {"kind": "pct", "value": 10}), 10000)
                discount, coupon = {"kind": "amount", "value": amt, "reason": "coupon WELCOME10", "by": "customer"}, {"code": "WELCOME10", "title": "10% off your order", "saves": amt}
            elif not online_ch and rng.random() < 0.09:
                discount, manual = {"kind": "pct", "value": rng.choice([5, 10, 15]), "reason": rng.choice(["Regular guest", "Service delay", "Staff meal"]), "by": "manager@demo.test"}, True
            totals = calc.compute(lines, discount, rate, mode).as_dict()
            total = totals["total"]
            iso = ts.isoformat()
            def at(mins, ts=ts):
                return (ts + timedelta(minutes=mins)).isoformat()

            actor = rng.choice(staff)
            b = {"bill_no": 1000 + seq, "type": online.ONLINE_TYPES[otype] if online_ch else otype, "table": None,
                 "customer": {"phone": cust[0] if cust else "", "name": cust[1] if cust else ""}, "lines": lines, "discount": discount, "status": "paid",
                 "payments": [], "refunds": [], "history": [], "revision": 4, "kot_batches": 1, "reprints": 0, "created_by": actor, "created_at": iso,
                 "business_date": local.date().isoformat() if local.hour >= 4 else (local.date() - timedelta(days=1)).isoformat(), "totals": totals, "closed_at": at(rng.randrange(35, 75))}
            if b["type"] == "Dine-in":
                b["table"] = rng.choice(tables) if tables else None
            hist = [{"ts": iso, "by": actor, "action": "create"}]
            for ln in lines:
                if not ln.get("fee"):
                    hist.append({"ts": at(0.5), "by": actor, "action": "add", "detail": {"item": ln["name"], "qty": ln["qty"]}})
            if manual:
                hist.append({"ts": at(1), "by": "manager@demo.test", "action": "discount", "detail": {"kind": "pct", "value": discount["value"]}})
            hist.append({"ts": at(2), "by": actor, "action": "kot", "detail": {"batch": 1}})
            # ---- how it was paid
            roll = rng.random()
            if online_ch:
                paid_online = rng.random() < 0.55
                cod_mode = rng.choices(["cash", "upi", "card"], [6, 3, 1])[0]
                parts = [("online", total)] if paid_online else [(cod_mode, total)]
            elif roll < 0.12 and total >= 40000:
                first = (rng.randrange(2, 8) * total // 10 // 100) * 100
                parts = [("cash", first), (rng.choice(["upi", "card"]), total - first)]
            else:
                parts = [(rng.choices(["cash", "upi", "card"], [4, 5, 2])[0], total)]
            pay_at = b["closed_at"]
            for pmode, amt in parts:
                if amt <= 0:
                    continue
                tendered = ((amt + 99) // 100 // 5 * 5 + 5) * 100 if pmode == "cash" and rng.random() < 0.5 else amt
                b["payments"].append({"id": uuid_hex(rng), "mode": pmode, "amount": amt, "tendered": tendered, "change": tendered - amt if tendered > amt else 0,
                                      "ref": f"pay_DEV{seq:06d}" if pmode == "online" else (f"UPI{rng.randrange(10**9):09d}" if pmode == "upi" else ""), "at": pay_at,
                                      "by": "razorpay" if pmode == "online" else actor})
            hist.append({"ts": pay_at, "by": actor, "action": "pay", "detail": {"amount": total, "left": 0}})
            # ---- how it ended
            end = rng.random()
            if end < 0.03:                                                  # cancelled before payment: void
                b["status"], b["payments"] = "void", []
                b.pop("closed_at")
                b["void"] = {"reason": rng.choice(["Customer left", "Wrong order", "Kitchen ran out"]), "by": "manager@demo.test", "at": at(10)}
                hist = hist[:-1] + [{"ts": at(10), "by": "manager@demo.test", "action": "void", "detail": {"reason": b["void"]["reason"]}}]
            elif end < 0.07:                                                # refunded in full
                p0 = b["payments"][0]
                for p in b["payments"]:
                    b["refunds"].append({"id": uuid_hex(rng), "amount": p["amount"], "mode": "online" if p["mode"] == "online" else p["mode"], "reason": rng.choice(["Food quality", "Wrong item", "Late delivery"]),
                                         "by": "manager@demo.test", "at": at(90), **({"payment_ref": p["ref"]} if p["mode"] == "online" else {})})
                b["status"] = "refunded"
                hist.append({"ts": at(90), "by": "manager@demo.test", "action": "refund", "detail": {"amount": p0["amount"]}})
            b["history"] = hist
            if online_ch:
                otype_l = otype
                flow = cfg["operations"]["flows"][otype_l]
                tl = [{"status": "placed", "at": iso, "by": "customer"}]
                if b["payments"] and b["payments"][0]["mode"] == "online":
                    tl.insert(0, {"status": "pending_payment", "at": iso, "by": "customer"})
                    tl[1]["at"] = at(1)
                drv = None
                if b["status"] == "void":
                    tl.append({"status": "cancelled", "at": at(10), "by": "manager@demo.test", "reason": b["void"]["reason"]})
                    final = "cancelled"
                else:
                    for i, st in enumerate(flow[1:], start=1):
                        if st == "out_for_delivery" and riders:
                            r = rng.choice(riders)
                            drv = {"id": str(r["_id"]), "name": r.get("name") or r["email"], "phone": r.get("phone", ""), "assigned_by": "manager@demo.test"}
                        tl.append({"status": st, "at": at(i * 11), "by": (drv or {}).get("name", actor) if st in ("out_for_delivery", "delivered") else actor})
                    final = flow[-1]
                b["channel"] = "online"
                b["created_by"] = f"customer:{cust[0]}"
                b["online"] = {"status": final, "customer_id": f"cust-{cust[0]}", "whatsapp_updates": True, "type": otype_l,
                               "address": {"text": rng.choice(ADDRESSES) + ", Hyderabad", "landmark": "", "lat": 17.43, "lng": 78.41} if is_delivery else None,
                               "distance_km": km, "payment_method": "online" if b["payments"] and b["payments"][0]["mode"] == "online" else "cod",
                               "notes": rng.choice(["", "", "Ring the bell twice", "Call on arrival", ""]), "driver": drv, "placed_at": iso,
                               "coupon": coupon, "timeline": tl}
                if b["online"]["payment_method"] == "online":
                    b["online"]["payment"] = {"provider": "razorpay", "order_id": f"order_DEV{seq:05d}", "key_id": RZP_KEY_ID, "amount": total, "status": "paid"}
                if b["table"] is None and otype_l == "dine-in":
                    b["table"] = rng.choice(tables) if tables else None
            batch.append(b)
    for b in batch:
        await tdb.bills.insert_one(b)
    await tdb.counters.update_one({"key": "bill_no"}, {"$set": {"seq": seq}}, upsert=True)
    return seq


def uuid_hex(rng) -> str:
    return f"{rng.getrandbits(32):08x}"


async def seed_chai(pdb, db, s) -> None:
    """A second, smaller restaurant so the platform-wide view has a restaurant dimension."""
    cfg = copy.deepcopy(json.loads((ROOT / "config" / "tenants" / "hyderabadi-irani.example.json").read_text()))
    cfg["slug"], cfg["brand"]["name"] = "demo-chai", "Demo Chai Corner"
    cfg["brand"]["legal_name"] = "Demo Chai Corner"
    cfg["pos"] = {"tables": [f"C-{i:02d}" for i in range(1, 7)]}
    cfg["delivery"]["origin"] = {"lat": 17.4126, "lng": 78.4482}
    tenant, token = await tenant_svc.create_tenant(pdb, lambda tid: TenantDB(db, tid), s, cfg, "chai@demo.test")
    tdb = TenantDB(db, tenant["_id"])
    await auth.accept_invite(tdb, token, DEMO_PW)
    for name, price, cat, station, veg, desc in MENU:
        if cat in ("Chai & Drinks", "Bakery", "Breads", "Starters"):
            await tdb.menu_items.insert_one({"name": name, "price": price, "category": cat, "station": station, "veg": veg, "available": True, "description": desc, "image_url": ""})
    docs = {i["name"]: i async for i in tdb.menu_items.find({})}
    for d in docs.values():
        d["_w"] = 6 if d["name"] in ("Irani Chai", "Osmania Biscuits (6)") else 2
    n = await seed_history(tdb, tenant["config"], docs, random.Random(7), 25, 3.0, [], delivery=False)
    print(f"  Seeded {n} bills for demo-chai (login chai@demo.test)")


async def seed(app) -> None:
    db = app.state.database
    s: Settings = app.state.settings
    pdb = PlatformDB(db)
    await auth.create_platform_admin(pdb, "root@nova.test", DEMO_PW)
    await pdb.platform_settings.update_one({"key": "whatsapp"}, {"$set": {"key": "whatsapp", "phone_number_id": "100000000000001", "waba_id": "200000000000001"}}, upsert=True)
    await secrets_svc.put(pdb, s, "platform", "whatsapp.access_token", "dev-whatsapp-token-0001", "dev")
    cfg = copy.deepcopy(json.loads((ROOT / "config" / "tenants" / "hyderabadi-irani.example.json").read_text()))
    cfg["slug"], cfg["brand"]["name"] = SLUG, "Demo Biryani House"
    cfg["brand"]["legal_name"] = "Demo Biryani House LLP"
    cfg["brand"]["colors"] = {"primary": "#E4572E", "secondary": "#14363B", "background": "#F6F4EF", "foreground": "#16211F", "muted": "#E6E2D8"}
    cfg["brand"]["fonts"] = {"heading": "Bricolage Grotesque", "body": "Figtree"}
    cfg["brand"]["tagline"] = "Dum biryani, Irani chai and Osmania biscuits"
    cfg["brand"]["address"] = "Plot 12, Road No. 3, Banjara Hills, Hyderabad"
    cfg["brand"]["hours"] = "Every day, 11:00 am to 11:30 pm"
    cfg["brand"]["support"] = {"phone": "9000000000"}
    cfg["delivery"]["origin"] = {"lat": 17.4126, "lng": 78.4482}
    cfg["delivery"]["driver_pay"] = {"base": 25, "per_km": 6}
    cfg["ordering"].update({"min_order": 150, "prep_minutes": 25})
    cfg["payments"]["cod"] = {"enabled": True}
    cfg["pos"] = {"tables": [f"T-{i:02d}" for i in range(1, 13)]}
    cfg["integrations"]["razorpay"]["secret_ref"] = f"secrets/{SLUG}/razorpay"
    cfg["payments"]["methods"] = ["cash", "card", "upi", "cod", "razorpay"]
    tenant, owner_token = await tenant_svc.create_tenant(pdb, lambda tid: TenantDB(db, tid), s, cfg, USERS[0][0])
    tdb = TenantDB(db, tenant["_id"])
    for name, val in (("razorpay.key_id", RZP_KEY_ID), ("razorpay.key_secret", RZP_KEY), ("razorpay.webhook_secret", RZP_HOOK)):
        await secrets_svc.put(pdb, s, tenant["_id"], name, val, "dev")
    await auth.accept_invite(tdb, owner_token, DEMO_PW)
    await tdb.users.update_one({"email": USERS[0][0]}, {"$set": {"name": USERS[0][2]}})
    for email, role, name in USERS[1:]:
        tok = await auth.create_invite(tdb, s, email, role, name)
        await auth.accept_invite(tdb, tok, DEMO_PW)
    for n, (email, role, _) in enumerate(USERS):
        if role == "delivery":
            await tdb.users.update_one({"email": email}, {"$set": {"phone": f"90000000{n:02d}"}})
    for name, price, cat, station, veg, desc in MENU:
        await tdb.menu_items.insert_one({"name": name, "price": price, "category": cat, "station": station, "veg": veg, "available": True, "description": desc, "image_url": ""})
    await tdb.coupons.insert_one({"code": "WELCOME10", "title": "10% off your order", "kind": "pct", "value": 10, "min_subtotal": 30000, "max_discount": 10000, "active": True})
    cust = {"phone": "9876500001", "name": "Sample Customer", "created_at": "2026-01-01T00:00:00+00:00", "token_version": 0, "addresses": [], "status": "active"}
    cust["_id"] = (await tdb.customers.insert_one(cust)).inserted_id
    docs = {i["name"]: i async for i in tdb.menu_items.find({})}
    for name, w in (("Chicken Dum Biryani", 12), ("Mutton Biryani", 6), ("Veg Biryani", 3), ("Chicken 65", 6), ("Paneer Tikka", 3), ("Butter Chicken", 5), ("Dal Makhani", 3),
                    ("Garlic Naan", 8), ("Irani Chai", 9), ("Fresh Lime Soda", 4), ("Double Ka Meetha", 3), ("Osmania Biscuits (6)", 3)):
        docs[name]["_w"] = w
    riders = [u async for u in tdb.users.find({"role": "delivery"})]
    n_hist = await seed_history(tdb, tenant["config"], docs, random.Random(42), 60, 9.5, riders)
    print(f"  Seeded {n_hist} bills of history for {SLUG} (last 60 days)")
    items = {n: str(d["_id"]) for n, d in docs.items()}
    await online.place_order(tdb, tenant["config"], cust, {"type": "takeaway", "items": [{"item_id": items["Chicken Dum Biryani"], "qty": 2}, {"item_id": items["Irani Chai"], "qty": 2}]}, None)
    await online.place_order(tdb, tenant["config"], cust, {"type": "delivery", "items": [{"item_id": items["Butter Chicken"], "qty": 1}, {"item_id": items["Garlic Naan"], "qty": 3}],
                                                           "address": {"text": "Flat 4B, Jubilee Hills Road 36, Hyderabad", "lat": 17.4300, "lng": 78.4100}}, None)
    await seed_chai(pdb, db, s)
    print(f"\n  Restaurant code: {SLUG}\n  Nova console login: root@nova.test (platform admin)\n  Logins (password for all: {DEMO_PW}):")
    for email, role, _ in USERS:
        print(f"    {role:<9} {email}")
    print("  Customer sign-in: any 10-digit mobile starting 6-9. debug_otp is returned in the response AND the WhatsApp message is printed here.")
    print("  Online payment is on for the demo restaurant: POST /dev/razorpay/pay {order_id} returns a valid payment signature.\n")


def build():
    if os.environ.get("ENV", "development") == "production":
        sys.exit("dev_server.py is for development only")
    origins = [f"http://{h}:{p}" for h in ("localhost", "127.0.0.1") for p in range(3000, 3011)]
    origins += [f"http://{h}:{p}" for h in ("localhost", "127.0.0.1") for p in range(4170, 4190)] + ["capacitor://localhost", "https://localhost", "http://localhost"]
    key = secrets.token_urlsafe(48)
    port = int(os.environ.get("PORT", "8000"))
    settings = Settings(env="development", jwt_keys={"dev": key}, jwt_active_kid="dev", allowed_origins=origins, db_name="dev", debug_otp=True,
                        secrets_key=Fernet.generate_key().decode(), public_base_url=f"http://127.0.0.1:{port}")
    app = create_app(settings, AsyncMongoMockClient()["dev"], http=httpx.AsyncClient(transport=httpx.MockTransport(FakeOutside().handler)))

    @app.post("/dev/razorpay/pay", include_in_schema=False)
    async def dev_pay(body: dict):
        """Stands in for Razorpay's checkout window: returns what the real one would hand back after a successful payment."""
        oid = str(body.get("order_id", ""))
        pid = "pay_DEV" + oid[-5:]
        return {"razorpay_order_id": oid, "razorpay_payment_id": pid, "razorpay_signature": payments.sign(oid, pid, RZP_KEY)}
    inner = app.router.lifespan_context

    @asynccontextmanager
    async def life(a):
        async with inner(a):
            await seed(a)
            yield
    app.router.lifespan_context = life
    return app


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(build(), host="127.0.0.1", port=port, log_level="warning")
