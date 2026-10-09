# 4. Data model

All tenant data carries `tenant_id` (string, indexed first in every compound index). `outlet_id` where location matters. Money is stored as **integer paise** in v2 (the source uses floats — a rounding risk).

## 4.1 New platform collections
| Collection | Key fields |
|---|---|
| `tenants` | `_id`, `slug`, `status` (trial/active/suspended), `plan`, `domains[]`, `config` (see schema), `created_at` |
| `outlets` | `tenant_id`, `name`, `address`, `location{lat,lng}`, `hours`, `delivery`, `tables_layout`, `status` |
| `subscriptions` | `tenant_id`, `plan`, `price`, `period`, `next_bill`, `usage_caps` |
| `usage_events` | `tenant_id`, `type` (order, whatsapp_msg, ai_token, voice_min, sms), `qty`, `cost_paise`, `ts` — feeds cost & margin views |
| `audit_log` | `tenant_id`, `actor`, `action`, `target`, `diff`, `ip`, `ts` |
| `integrations` | `tenant_id`, `kind` (razorpay, whatsapp, fcm, meta_ads, google_ads), `status`, `secret_ref` (never the secret) |
| `app_builds` | `tenant_id`, `platform`, `app_id`, `version`, `status` — white-label pipeline |

## 4.2 Source collections → v2
| Source | v2 changes |
|---|---|
| `users` | add `tenant_id`, `outlet_ids[]`, `role_id`, `mfa`, `devices[]`; unique `(tenant_id,email)` |
| `customers` | add `tenant_id`; unique `(tenant_id,phone)`; consent flags; `tags[]` |
| `menu_items` | add `tenant_id`, `tax_rate`, `prep_minutes`, `allergens[]`, `outlet_overrides{}`, `price_paise`; variants normalized |
| `orders` | add `tenant_id`, `outlet_id`, `channel` (pos/web/app/whatsapp/aggregator), `price_paise` fields, status history array, `payment` sub-document, `refunds[]` |
| `coupons` | add `tenant_id`, `valid_from/to`, `usage_cap`, `per_customer_cap`, `stackable` |
| `loyalty_transactions` | add `tenant_id`; ledger is append-only |
| `tables` | per `outlet_id`; remove 50-table seed; layout + QR token |
| `settings` | replaced by `tenants.config` + `outlets` |
| `counters` | key `(tenant_id, outlet_id, business_day)` |
| `otp_verifications`, `login_attempts` | add `tenant_id`; TTL indexes |
| `driver_locations`, `device_tokens` | add `tenant_id`; TTL on stale locations |
| `payment_logs` | add `tenant_id`, `order_id`; immutable |

## 4.3 Index checklist
`orders`: `(tenant_id, outlet_id, created_at desc)`, `(tenant_id, status, created_at)`, unique `(tenant_id, order_no)`, unique sparse `(tenant_id, offline_no)`.
`customers`: unique `(tenant_id, phone)`. `menu_items`: `(tenant_id, category, available)`.
The source relies on a `DuplicateKeyError` retry for order numbers — v2 needs the unique index defined in code/migrations, not assumed.

## 4.4 Reporting at scale
The source's `/stats` loads up to 2,000 orders into memory. v2 uses aggregation pipelines and a daily `rollups` collection (`tenant_id, outlet_id, day, revenue, orders, tax, by_channel, by_hour, top_items`) written at order close; dashboards read rollups.
