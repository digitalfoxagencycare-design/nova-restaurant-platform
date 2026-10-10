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
import secrets
import sys
from contextlib import asynccontextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import email_validator  # noqa: E402
import uvicorn  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

from nova.app import create_app  # noqa: E402
from nova.core.config import Settings  # noqa: E402
from nova.services import auth, online  # noqa: E402
from nova.services import tenants as tenant_svc  # noqa: E402
from nova.tenancy.db import PlatformDB, TenantDB  # noqa: E402

email_validator.TEST_ENVIRONMENT = True      # dev only: lets the reserved .test domain through the e-mail check
SLUG = "demo-biryani"
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


async def seed(app) -> None:
    db = app.state.database
    s: Settings = app.state.settings
    pdb = PlatformDB(db)
    await auth.create_platform_admin(pdb, "root@nova.test", DEMO_PW)
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
    tenant, owner_token = await tenant_svc.create_tenant(pdb, lambda tid: TenantDB(db, tid), s, cfg, USERS[0][0])
    tdb = TenantDB(db, tenant["_id"])
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
    items = {i["name"]: str(i["_id"]) async for i in tdb.menu_items.find({})}
    await online.place_order(tdb, tenant["config"], cust, {"type": "takeaway", "items": [{"item_id": items["Chicken Dum Biryani"], "qty": 2}, {"item_id": items["Irani Chai"], "qty": 2}]}, None)
    await online.place_order(tdb, tenant["config"], cust, {"type": "delivery", "items": [{"item_id": items["Butter Chicken"], "qty": 1}, {"item_id": items["Garlic Naan"], "qty": 3}],
                                                           "address": {"text": "Flat 4B, Jubilee Hills Road 36, Hyderabad", "lat": 17.4300, "lng": 78.4100}}, None)
    print(f"\n  Restaurant code: {SLUG}\n  Logins (password for all: {DEMO_PW}):")
    for email, role, _ in USERS:
        print(f"    {role:<9} {email}")
    print("  Customer sign-in: any 10-digit mobile starting 6-9; the code is returned in the response (debug_otp).\n")


def build():
    if os.environ.get("ENV", "development") == "production":
        sys.exit("dev_server.py is for development only")
    origins = [f"http://{h}:{p}" for h in ("localhost", "127.0.0.1") for p in range(3000, 3011)]
    origins += [f"http://{h}:{p}" for h in ("localhost", "127.0.0.1") for p in range(4170, 4190)] + ["capacitor://localhost", "https://localhost", "http://localhost"]
    key = secrets.token_urlsafe(48)
    settings = Settings(env="development", jwt_keys={"dev": key}, jwt_active_kid="dev", allowed_origins=origins, db_name="dev", debug_otp=True)
    app = create_app(settings, AsyncMongoMockClient()["dev"])
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
