# 3. Target architecture

## 3.1 Product map
```
                         ┌──────────────────────────────────────┐
                         │  NOVA MASTER CONSOLE (web + mobile)   │
                         │  all tenants: health, revenue, costs, │
                         │  onboarding, billing, support, ads    │
                         └───────────────▲──────────────────────┘
                                         │ platform admin API
┌────────────── per tenant (restaurant) ─┴───────────────────────────────┐
│  Restaurant Console (web)   Staff/POS (web+desktop)   Kitchen Display   │
│  Owner mobile app           Delivery app              Customer app/web  │
└───────────────▲─────────────────────────────────────────────▲──────────┘
                │ REST + realtime (WebSocket/SSE)              │ webhooks
        ┌───────┴──────────────── Platform API ───────────────┴────────┐
        │ auth/tenancy · orders · menu · promotions · loyalty · tables  │
        │ delivery · reports · notifications · billing · media          │
        └───────▲───────────────▲───────────────▲──────────────────────┘
                │               │               │
          MongoDB/Atlas     Redis (queues,    Object storage
          (tenant-scoped)   cache, pubsub)    (tenants/{id}/…)
                                │
                  Nova WhatsApp gateway · Razorpay · FCM · Maps
```

## 3.2 Apps
| App | Users | Platform | Source equivalent |
|---|---|---|---|
| **Nova Master Console** | Nova team | Web (+ mobile companion) | none (new) — prototype in `design/` |
| **Restaurant Console** | owner/manager | Web | `Dashboard`, `MenuAdmin`, `OffersAdmin`, `StaffAdmin`, `CustomerAdmin`, `TableAdmin` |
| **POS / Billing** | cashier | Web + Windows print agent | `Pos.jsx`, `print-agent` |
| **Kitchen Display** | kitchen | Web (tablet) | `Kitchen.jsx` |
| **Customer app / storefront** | diners | Web + white-label Android/iOS | `Storefront`, `Checkout`, `mobile-customer-app` |
| **Delivery app** | riders | Android (+ iOS later) | `DeliveryApp`, `mobile-delivery-app` |
| **Owner mobile app** (Nova-branded) | owners | Android/iOS (one app, many tenants) | none (new) |

## 3.3 Tenancy model
- `tenant` = a business (brand). `outlet` = a physical location of a tenant. Orders, tables, drivers, stock belong to an outlet; menu, promotions, customers, loyalty belong to the tenant (with optional per-outlet overrides).
- **Row-level tenancy** (shared database, `tenant_id` on every document) — right for hundreds of small businesses; dedicated database per tenant is an upgrade path for large customers.
- **One data-access layer** injects `tenant_id` into every filter and insert; raw `db.*` access from route handlers is banned (lint rule). Cross-tenant access is impossible by construction, then proven by tests.
- Tenant resolved from: JWT claim (staff apps), `X-Tenant`/domain (public storefront), app build config (white-label apps).
- Tenant config is cached (Redis) and versioned; changes are audited.

## 3.4 Auth & roles
- Staff: email/phone + password or OTP; short access tokens (15–60 min) + refresh rotation; per-device sessions; MFA for owners/Nova admins.
- Customers: phone OTP (WhatsApp first, SMS fallback) — keep the source's cooldown/attempt limits.
- Roles are data: `owner`, `manager`, `cashier`, `kitchen`, `delivery`, `viewer` + custom roles built from permissions (`orders.refund`, `menu.edit`, `reports.view`, …). Nova roles: `platform_admin`, `support`.

## 3.5 Realtime
Replace 8–30 s polling (Orders, Kitchen) with WebSocket/SSE channels per outlet (`orders`, `kitchen`, `tables`, `drivers`), backed by Redis pub/sub. Keep polling as fallback.

## 3.6 Payments
Razorpay per tenant (own keys, or Razorpay Route so Nova can collect and settle). Server verifies signatures; payment attempts logged; refunds through API with reason and audit. Nova's own subscription billing is separate from the tenant's customer payments.

## 3.7 WhatsApp & notifications
Use the existing **Nova WhatsApp gateway** (`ops.novasaas.net`, per-project client keys) instead of direct Meta tokens in each app. Templates per tenant/locale; opt-in and STOP honoured; FCM for app push. Later: WhatsApp ordering bot (menu → cart → pay) reusing `OrderService`.

## 3.8 Offline & printing
Keep the POS offline queue + idempotent sync (`offline_no`). Add conflict handling (menu version, price changes) and a per-outlet device registry. Print agent stays local; add a cloud print queue for tablet-only outlets.

## 3.9 Observability
Structured logs with `tenant_id`, request id; metrics (orders/min, p95 latency, failed payments); alerting; per-tenant usage metering (orders, WhatsApp messages, AI tokens) that feeds the master console's cost view.

## 3.10 Suggested stack
Keep what works: **FastAPI + MongoDB (Motor)**, React, Capacitor, Razorpay, FCM, Cloud Run, Cloudflare. Add Redis, a task queue (Arq/Celery), WebSockets, OpenTelemetry. Split `server.py` into modules (`auth`, `tenants`, `menu`, `orders`, `promotions`, `loyalty`, `delivery`, `reports`, `notifications`, `media`) with shared `core` (tenancy, security, money).
