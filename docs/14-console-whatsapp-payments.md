# 14. Nova console, WhatsApp from Nova's number, online payment

## Who does what
| Person | Where | What they can do |
|---|---|---|
| Nova team (you) | Nova console (`/v2/platform/*`) | onboard restaurants, set brand/logo/colours/fonts and settings, store each restaurant's payment keys, connect Nova's WhatsApp number, pause/resume, see usage and health, export data, work the list of interested restaurants |
| Restaurant owner / staff | web admin `/app/`, Owner app | run their own restaurant only |
| Customers, riders | customer app / website, delivery app | order, deliver |

Roles for Nova staff: `platform_admin` (everything) and `support` (look at restaurants and work enquiries; cannot change settings, keys or plans).

## Onboarding a new client (what the console does)
1. `GET /platform/tenant-template` gives a ready starting configuration; fill name, slug (their web address), colours, fonts, address, hours, phone, tax, delivery area, channels.
2. `POST /platform/tenants` creates the restaurant and an owner invite link.
3. `POST /platform/tenants/{id}/logo` (PNG/JPEG/WebP up to 400 KB; SVG is refused because it can carry scripts).
4. Give the owner their one-time sign-up link (`POST /platform/tenants/{id}/owner-invite` makes a fresh one if it was lost).
5. Add their Razorpay keys (`PUT /platform/tenants/{id}/secrets/razorpay.key_id|key_secret|webhook_secret`). Keys are encrypted with `SECRETS_KEY`, shown back only as "set" plus the last 4 characters.
6. The restaurant detail shows a checklist (brand, owner accepted, menu, shop location, payment keys, WhatsApp, first order) and the links to give them.

## WhatsApp from your number
All restaurants send from ONE number (yours). Sign-in codes and order updates (placed, being prepared, ready, on the way with the delivery code, delivered, cancelled) all arrive from it.
- You need: a WhatsApp Business account with the number registered in the Meta developer app, its **phone number id**, a **permanent access token** (system user), and two approved templates.
- Enter them in the console (`PUT /platform/settings/whatsapp`, `PUT /platform/settings/whatsapp/token`). The token is never shown again. `POST /platform/settings/whatsapp/test` sends a real message to a phone so you can see it work.
- Templates to create in Meta Business Manager (names are changeable in the console):
  - `nova_login_code`, category **Authentication**, language English, body "{{1}} is your verification code." with the **copy code** button.
  - `nova_order_update`, category **Utility**, language English, body: "{{1}}: your order #{{2}} is {{3}}. Track it here: {{4}}"
- Customers agree to order messages at checkout (a tick box, on by default, in the customer app); a restaurant can switch them off with `integrations.whatsapp.order_updates = false`.
- A message that fails never blocks an order. Every message is counted per restaurant (`usage_events`) so Meta's charges can be passed on later.
- Without the connection, production refuses to send sign-in codes (it never pretends).

## Online payment (Razorpay, each restaurant's own account)
- Money goes straight to the restaurant's Razorpay account. Nova never holds it.
- Checkout: `POST /me/orders {payment:"online"}` creates the order as `pending_payment` and a Razorpay order for the exact total. The customer pays in Razorpay's window; the app then calls `POST /me/orders/{id}/payment` with the three Razorpay values; the server checks the signature with the restaurant's secret key. The webhook (`POST /v2/webhooks/razorpay/{slug}`, set in the restaurant's Razorpay dashboard with the same webhook secret) confirms it too if the app was closed. Either path alone is enough and repeating one changes nothing.
- An order is invisible to the kitchen and staff until it is paid. Unpaid orders are cancelled after 20 minutes. If money arrives after that, it is refunded automatically.
- Cancelling a paid order (by the customer while it is still new, or by staff with a reason) refunds the full amount through Razorpay first; if Razorpay refuses, the order stays alive and the error is shown.
- The bill closes as a paid sale when the order is finished; the day report shows the amount under `online`.
- Not included yet: partial refunds, Razorpay settlements reports, UPI-intent deep links outside Razorpay checkout, other providers.

## Enquiries (interested restaurants)
`POST /v2/public/leads` (public form: name, restaurant, phone, city, message; hidden honeypot field; 5 per hour per visitor) -> the console lists them (`new, contacted, demo, onboarded, lost`) with notes.

## Operating it
- Server settings (environment): `SECRETS_KEY` (generate with `python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"`, keep it safe: losing it means re-entering all keys), `PUBLIC_BASE_URL` (https address of the ordering site), plus the existing `JWT_KEYS`, `MONGO_URL`, `ALLOWED_ORIGINS`. Production refuses to start without them.
- `GET /platform/health`, `/platform/overview`, `/platform/tenants/{id}/usage` for the dashboard; `/platform/audit` for who changed what.
- Off-boarding: `GET /platform/tenants/{id}/export` (no passwords, PINs or payment keys), then suspend.
