# 1. Source analysis — `HyderabadiIrani`

Read-only analysis of the repository at commit `4b57b42` (private). ~640 tracked files, ~16,000 lines of application code.

## 1.1 What it is
A complete single-restaurant system for **Hyderabadi Irani Food Court** (Secunderabad, India): web storefront, online ordering with delivery, dine-in table QR ordering, POS billing with thermal printing, kitchen display, delivery-partner app, customer Android app, loyalty "Irani Royalty Coins", coupons, GST reporting.

## 1.2 Components
| Component | Path | Tech | Notes |
|---|---|---|---|
| Backend API | `backend/server.py` (3,623 lines) | FastAPI, Motor (MongoDB), PyJWT, bcrypt, Razorpay SDK, ReportLab, Pillow | One file; ~95 routes under `/api` |
| WhatsApp helper | `backend/whatsapp_service.py` | Meta Cloud API direct + Nova gateway fallback | OTP template `novasaas_otp`, order-status messages |
| Web app | `frontend/` | React (CRA + craco), Tailwind, shadcn/ui, Recharts | Storefront, checkout, POS, kitchen, admin, delivery web, live tracking |
| Customer app | `mobile-customer-app/` | Capacitor 6 + Vite + React, Firebase push, Geolocation, Razorpay plugin, Leaflet | App id `com.hyderabadiirani.app`; table QR scanner |
| Delivery app | `mobile-delivery-app/` | Capacitor + Vite + React | App id `com.hyderabadiirani.delivery`; accept orders, GPS, OTP hand-off |
| Print agent | `print-agent/`, `HYDERABADI_IRANI_PRINT_AGENT_CLIENT/` | Node, raw Windows spooler (port 8989), ESC/POS | Zero-dialog thermal printing; also WebUSB/Bluetooth paths in `frontend/src/lib/` |
| Scripts | `scripts/` | Python | Menu import, image generation (Vertex), backups, checks |
| Infra | `docker-compose.yml`, `DEPLOY.md`, `frontend/cloudbuild.yaml` | Cloud Run, Cloudflare, MongoDB Atlas, GCS | Backend on Cloud Run (asia-south1) |
| Tests | `backend/tests/` | pytest (≈59 tests), mongomock | Plus agent test logs in `test_reports/` |

## 1.3 Screens (web)
Public: Storefront, Checkout, Track order, Customer account, Legal pages (privacy, terms, refund, cancellation, shipping, contact).
Staff: POS (1,669 lines), Orders, Live tracking, Kitchen display, Delivery web app.
Admin: Dashboard, Menu admin (1,785 lines), Offers/coupons, Staff, Customers (CRM), Tables.

## 1.4 Roles
`admin`, `staff`, `kitchen`, `delivery` (+ customers authenticated separately by phone OTP/password). Admin-only routes use `require_admin`; others use `get_current_user`.

## 1.5 Core flows
**Order creation (`_build_order`)** — the heart of the system and its best-written part:
1. Idempotency by `offline_no` (offline POS orders sync safely).
2. Validation: Indian mobile format; delivery address length; **5 km delivery radius** via haversine; **COD disabled 22:00–06:00 IST**; dine-in needs a table; customer self-service dine-in must be prepaid.
3. **Prices resolved server-side** from `menu_items` (variants: half/full/named) — client prices ignored.
4. Coupons: percent / fixed / freebie; scope cart / item / category; channel both / online / pos; min order; max discount.
5. Loyalty coins redemption (rules below).
6. Delivery fee slabs; free over ₹499.
7. GST: 5% **inclusive** (tax extracted from total).
8. Order number `YYMMDD-NNNN` from an atomic daily counter; business day rolls over at **04:00 IST**.
9. Status `pending_payment` for online payments else `placed`; loyalty coins credited when placed.

**Status machine**: `placed → preparing → ready → out_for_delivery → delivered`, or `served` / `completed` (dine-in/takeaway), `cancelled`. Each change triggers FCM push to the customer, WhatsApp status message, and a push to drivers when a delivery order becomes `ready`.

**Payments**: Razorpay order → client checkout → server-side signature verify; "switch to COD" fallback; payment attempt log. Online dine-in and late-night delivery must be prepaid.

**Loyalty**: ₹100 spent = 1 coin; 1 coin = ₹1; 100-coin welcome bonus; ₹25 off on the first 4 orders above ₹249; max 50% of subtotal via coins; min 20 coins to redeem.

**Delivery**: drivers accept orders, post GPS (`driver_locations`), per-order location, deliver with OTP hand-off; admin sees all drivers on a live map.

**Kitchen**: queue of `placed/preparing/ready` orders (polling), station routing (`kitchen`, `beverage`, `bakery`), KOT print (`/kot/{order_no}`), notification sound.

**Reports**: dashboard stats, day-end summary (JSON + PDF), monthly GST (JSON + PDF), orders CSV export, invoice PDF.

**Menu**: CRUD, availability per item and per category, category ordering, bulk price adjust (₹/%), bulk import (sheet), image upload → compressed WebP (<50 KB) → Google Cloud Storage, "pairings" (suggested items shelf).

**Offline**: POS keeps an IndexedDB queue (`offlineDb.js`) and a sync engine (`syncEngine.js`) posting with `offline_no` for idempotency.

## 1.6 MongoDB collections in use
`orders`, `customers`, `menu_items`, `users`, `otp_verifications`, `coupons`, `tables` (+ `tables_override`), `settings` (store status), `payment_logs`, `loyalty_transactions`, `login_attempts`, `driver_locations`, `device_tokens`, `counters`.

## 1.7 External services
MongoDB Atlas · Razorpay · Meta WhatsApp Cloud API (direct) + Nova gateway fallback · Firebase Cloud Messaging · Google Cloud Storage · Google Cloud Run · Cloudflare · Vertex AI (image generation scripts).

## 1.8 What is already strong (keep)
Server-side pricing and totals; idempotent offline orders; atomic order numbering; business-day logic; login lockout and token versioning; CSRF double-submit for cookie sessions; OTP cooldown/attempt limits; real push + WhatsApp order updates; real thermal printing; tests for the main flows.

## 1.9 What blocks reuse as a product
See [02-standardization.md](02-standardization.md) (hard-coding) and [08-security-findings.md](08-security-findings.md). In one line: **the system assumes exactly one restaurant** — there is no tenant concept anywhere, and ~145 brand strings and many business rules are literals in code.
