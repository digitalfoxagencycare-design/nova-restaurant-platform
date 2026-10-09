# 6. Mobile apps

## 6.1 What exists
- **Customer app** (Capacitor + React): browse, cart, checkout (Razorpay plugin), table-QR scanner, order tracking with map, push notifications, location picker, loyalty, account.
- **Delivery app** (Capacitor + React): login, order list, accept, live GPS, deliver with OTP.
- Both are single-brand, Android only, with Firebase config files committed.

## 6.2 Target: three app families
| App | Audience | Branding | Distribution |
|---|---|---|---|
| **Nova Owner** | restaurant owners/managers (and Nova team in "master" mode) | Nova brand; one app, switch between businesses | Play Store / App Store (one listing) |
| **Customer app** | diners | white-label per tenant | per-tenant listing (premium plan) **or** one shared "Nova Eats" app with tenant directory |
| **Delivery app** | riders | Nova-neutral, tenant name inside | one shared listing |

### Nova Owner app — screens
Today (sales, orders, open tickets) · Live orders (accept/reject, mark ready) · Menu on/off (86 items fast) · Tables · Reports (day-end, GST) · Customers & offers · Ads & costs (read-only) · Alerts (low credits, failed payments, store offline) · Settings (hours, delivery, staff).
Master mode (Nova team): all-tenants overview, onboarding queue, health, revenue/costs, support tickets.

## 6.3 Build approach
Keep **Capacitor + React** (shared code with web). Create `packages/ui` (tokens + components), `packages/api-client` (generated from OpenAPI), `packages/pos-core`. A **white-label pipeline** (CI job) takes `tenant.config` → app id, name, icons, splash, colours, `google-services.json` → signed AAB. Secrets (keystores, Firebase) live in the CI secret store, never in the repo.

## 6.4 Mobile requirements checklist
Offline cache of menu/orders; push with deep links; biometric lock for owner app; deep link from WhatsApp order message to tracking page; accessibility (font scaling, contrast); Telugu / Hindi / English strings from day one; Play data-safety form and privacy policy generated from tenant legal documents.
