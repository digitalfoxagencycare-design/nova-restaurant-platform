# Nova Owner (owner, manager and cashier app)

Vite + React 18 + Tailwind 3 + Capacitor 6. White-label: brand comes from `GET /v2/public/{code}/storefront` via `applyBrand`.

## Run
```bash
python scripts/dev_server.py            # API on :8000, restaurant code demo-biryani (logins are printed)
cd apps/owner && npm install
npm run dev                             # http://127.0.0.1:5175
npm run build                           # dist/
```
Demo logins: `owner@`, `manager@`, `cashier@demo.test`, restaurant code `demo-biryani`. The dev API only allows browser origins on
ports 3000-3010 and 4170-4189 (`npm run preview` uses 4175).

## Environment
| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | API server (default `http://127.0.0.1:8000`) |
| `VITE_TENANT` | Fix the restaurant for a per-restaurant build (hides the Restaurant code field) |

## White-label / Android build
Set `VITE_TENANT`, `VITE_API_BASE_URL`, adjust `appId`/`appName` in `capacitor.config.json`, `npm run build`, `npx cap sync android`.
`android/` is committed without `google-services.json`, keystores or passwords.

## What it does
Today (online-ordering switch, notice, auto-accept, sales tiles, channel and payment split, 7-day bars, best sellers, new-order banner),
Orders (scope + channel filters, search, one-tap next step, assign-rider sheet, payment sheet on `PAYMENT_DUE`, cancel with reason, detail sheet,
10 s polling with vibration, toast, tab badge and an opt-in Sound toggle), Menu (search, categories, sold-out switch, add/edit dish,
bulk sold-out/available and price %), More (Customers, Offers, Riders, Tables, Staff with invite token, Day summary, sign out).
Controls are hidden when the role cannot use them: counter permissions come from `/v2/pos/rules`; order, customer, coupon and user rights
mirror the built-in role table, and any 403 is shown as a plain message.

## Not included
Push notifications (new-order alerts work only while the app is open), accepting an invite (the token is shown for the owner to hand over),
changing veg/non-veg of an existing dish (API does not allow it), editing tenant config, refunds/voids (use the POS), offline mode, i18n.
