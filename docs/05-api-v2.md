# 5. API v2 map

Base: `/v2`. Tenant from token or `X-Tenant`. All lists paginated; all writes idempotent where retried by clients (`Idempotency-Key`).

| Area | Source v1 (examples) | v2 |
|---|---|---|
| Auth | `/auth/login`, `/auth/refresh`, `/customer/auth/send-otp`, `/verify-otp` | same shapes + `tenant_id` claim, MFA, device sessions |
| Tenants (new) | — | `GET/PUT /tenants/me`, `GET/PUT /tenants/me/config`, `POST /platform/tenants` (Nova admin), `POST /platform/tenants/{id}/suspend` |
| Outlets (new) | — | CRUD `/outlets`, hours, delivery zones |
| Menu | `/menu`, `/menu/{id}`, bulk price, bulk import, availability, categories order, upload image | same, plus `/menu/import` (CSV/XLSX preview → commit), per-outlet overrides, versioning |
| Orders | `/orders`, `/public/orders`, `/orders/{id}/status`, `/kitchen/queue` | `POST /orders` (channel field), `PATCH /orders/{id}/status` driven by tenant flow, `GET /orders` filters, realtime `/ws/outlets/{id}` |
| Payments | `/payments/razorpay/order`, `/verify`, `/switch-to-cod`, `/log-attempt` | per-tenant keys; `POST /payments/{id}/refund`; webhook `/webhooks/razorpay` (the source has no webhook — add it) |
| Promotions | `/coupons*`, `/coupons/validate` | `/promotions*` with caps and windows |
| Loyalty | `/loyalty/rules`, `/customer/loyalty/transactions` | `/loyalty/config`, `/customers/{id}/points` |
| Customers | `/customer/*`, `/admin/customers`, `/customers/lookup` | `/customers` (CRM: tags, segments, export) |
| Tables | `/tables` (duplicated route in source), `/tables/{no}/status` | `/outlets/{id}/tables` with auth |
| Delivery | `/delivery/orders`, `/accept`, `/location`, `/delivered`, `/admin/drivers/locations` | same, plus assignment strategies, proof-of-delivery |
| Reports | `/stats`, `/reports/day-end(.pdf)`, `/gst-monthly(.pdf)`, `/reports/export/orders.csv`, `/invoice/{no}`, `/kot/{no}` | read from rollups; `/reports/*` with outlet/date filters; scheduled email/WhatsApp digests |
| Notifications | `/notifications/register-token`, `/unregister-token` | + preferences, templates per tenant/locale |
| Platform (new) | — | `/platform/overview`, `/platform/usage`, `/platform/costs`, `/platform/ads`, `/platform/health` — what the master console reads |
| Setup | public `/setup/seed` (**remove**) | invite-based tenant bootstrap |

## Contract rules
- Money in integer paise; ISO-8601 UTC timestamps; IDs as strings.
- Errors: `{code, message, details}`; stable codes (`OUT_OF_DELIVERY_RANGE`, `COD_UNAVAILABLE`, `ITEM_UNAVAILABLE` …) so mobile apps can localise.
- OpenAPI published per version; contract tests run in CI.
