# 2. Standardization — from one restaurant to any restaurant

Everything below is a literal or assumption in the source that must become **tenant configuration** (or a data row) in the platform. Config keys refer to [`config/tenant.schema.json`](../config/tenant.schema.json).

## 2.1 Business rules in code → config
| Source (file) | Today | Config key |
|---|---|---|
| `server.py` `GST_RATE` | 5 % inclusive, single rate | `tax.mode` (`inclusive`/`exclusive`), `tax.default_rate`, per-item `tax_rate`, `tax.gstin` |
| `STORE_LAT/LNG` | one store location | `outlets[].location` |
| `MAX_DELIVERY_DISTANCE_KM = 5` | hard limit | `delivery.max_km` (per outlet), optional polygons later |
| delivery fee slabs ≤2/3/4/5 km = ₹20/30/40/50; free ≥ ₹499 | literals | `delivery.fee_slabs[]`, `delivery.free_above` |
| COD off 22:00–06:00 IST | literals | `payments.cod.disabled_windows[]`, `payments.cod.enabled` |
| Dine-in self-order must be prepaid | rule | `ordering.dine_in.require_prepaid_for_self_order` |
| Business day starts 04:00 IST | literal | `operations.business_day_start`, `operations.timezone` |
| Order number `YYMMDD-NNNN` | fixed | `operations.order_number_format` (+ outlet prefix) |
| Tables `T-01…T-50`, capacity 4 | seeded in code | `tables[]` rows per outlet; layout editor |
| Loyalty constants (earn 1/₹100, welcome 100, ₹25×4 orders, min ₹249, min redeem 20, max 50 %) | literals | `loyalty.*` block (or disabled) |
| Stations `kitchen/beverage/bakery` | fixed | `operations.stations[]` |
| Order statuses & which are allowed for which order type | fixed | `operations.flows[order_type]` (state list per type) |
| Notification copy ("Chef is now preparing…", "Irani") | strings | `notifications.templates[locale][status]` |
| WhatsApp template `novasaas_otp`, project `hyderabadi-irani` | literals | `integrations.whatsapp.*` per tenant |
| Currency ₹ / INR, +91 phone rules (`^[6-9]\d{9}$`) | literals | `locale.currency`, `locale.phone_regex`, `locale.country_code` |
| Legal pages (privacy, terms…) | 577-line hard-coded page | tenant-editable legal documents with a base template |

## 2.2 Brand and content
~145 occurrences of "Hyderabadi Irani" in code plus assets (logo, colours, fonts, hero, Play Store graphics). Replace with:
- `brand.name`, `brand.legal_name`, `brand.logo_url`, `brand.colors` (design tokens), `brand.fonts`, `brand.hero[]`, `brand.social`, `brand.support`.
- Theme comes from **design tokens**, not Tailwind constants (the source's `design_guidelines.json` is already a token-like document — extend it).
- Menu, categories, pairings, coupons, images → tenant **data**, never seed code. The seed menu in `server.py` and 20+ `scripts/` become an **import tool** (CSV/XLSX/JSON → menu).

## 2.3 Infrastructure literals
| Source | Replace with |
|---|---|
| CORS allow-list with the brand domain | per-tenant allowed origins derived from `tenants.domains[]` |
| `ADMIN/STAFF/DRIVER` email+password env vars and public `/setup/seed` | tenant bootstrap flow: invite link for the owner; no seeded shared passwords |
| One `JWT_SECRET` | per-environment secret + `tenant_id` claim; key rotation (`kid`) |
| One Razorpay key pair | per-tenant keys (or Razorpay Route / marketplace) |
| One WhatsApp phone id / WABA | per-tenant WhatsApp connection via the Nova gateway |
| One FCM project | one FCM project for the platform; per-tenant topics; or per-tenant for white-label |
| One GCS bucket | one bucket, path `tenants/{tenant_id}/…` |
| Android app ids `com.hyderabadiirani.*` | white-label build pipeline: app id, name, icons, `google-services.json` per tenant |

## 2.4 The reusable core (verbatim candidates)
- Order builder (`_build_order`) → `OrderService.price_and_validate(config, cart)`.
- Coupon engine → `PromotionService` (add stackability, time windows, usage caps).
- Loyalty ledger (`loyalty_transactions`) → generalized points ledger.
- Status machine + notifications → `FlowEngine` driven by `operations.flows`.
- ESC/POS builder (`escpos.js`), print agent, offline queue + sync engine → shared `@nova/pos-core`.
- GST day-end / monthly PDFs → `ReportService` with tenant tax config.
- Image pipeline (<50 KB WebP) → `MediaService`.

## 2.5 What to add for a product (not in the source)
Tenants, outlets, subscription/billing for Nova itself, per-tenant roles/permissions, audit log, inventory/recipe costing, reservations, multi-outlet reporting, aggregator/online-channel inbox, WhatsApp ordering bot, feedback/ratings, staff shifts, tips, refunds workflow, data export, GDPR/DPDP data-deletion tooling.
