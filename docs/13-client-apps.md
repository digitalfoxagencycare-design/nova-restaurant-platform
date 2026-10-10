# 13. Client apps (one codebase for every restaurant)

| Folder | What | Who uses it | Ships as |
|---|---|---|---|
| `apps/customer` | Landing page + ordering storefront + customer app | diners | website at `/s/<restaurant-code>` and an Android app per restaurant |
| `apps/delivery` | Delivery partner app | riders | Android app (restaurant code typed at sign-in, or fixed per build) |
| `apps/owner` | Owner / manager app | owner, manager, cashier | Android app |
| `web/` | Web admin + counter (POS), served at `/app/` | owner, manager, cashier, kitchen | website |
| `packages/shared` | API client, money/time helpers, white-label theme, base styles | all of the above | source alias `@nova/shared` |

## White-label rule
Nothing restaurant-specific is written in code. A restaurant is a tenant record. Every app asks the API for the restaurant's
storefront config (`GET /v2/public/{code}/storefront`) and calls `applyBrand(config.brand)` from `@nova/shared`, which turns the
restaurant's colours and fonts into CSS variables (`--brand`, `--accent`, ...). Components use only the Tailwind tokens from
`packages/shared/tailwind-preset.js` (`bg-brand`, `text-accent`, ...). Until the config loads, or if it has no colours, the Nova defaults apply.
"Powered by Nova" with the Nova logo (`packages/shared/assets/nova-logo.png`) stays in the footer / about screens.

The restaurant code comes from, in order: the URL (`/s/<code>` or `?t=<code>`) on the web, `VITE_TENANT` at build time (a per-restaurant Android
build), or a "Restaurant code" field on the sign-in screen (delivery and owner apps), remembered on the device.
API base URL: `VITE_API_BASE_URL` (default `http://127.0.0.1:8000` in development).

## Per-restaurant Android build (white-label pipeline, to be wired in CI)
Inputs from the tenant record: app id (`com.nova.<code>`), app name, icon and splash from the logo, colours, `VITE_TENANT`,
`VITE_API_BASE_URL`, optional Firebase file and signing key from the CI secret store. Keystores and Firebase files are never committed.

## Run it locally
```bash
pip install -r backend/requirements-dev.txt
python scripts/dev_server.py          # API on :8000 with the demo restaurant `demo-biryani` (see the printed logins)
cd apps/customer && npm install && npm run dev
```

## Design language
Mobile first (390 px), big touch targets (44 px), one action colour per screen (`accent`), dark `brand` for headers and navigation,
Bricolage Grotesque (headings) and Figtree (text) unless the restaurant sets fonts, flat dish illustrations when a dish has no photo,
bottom sheets instead of full-page modals, clear empty / loading / error states, Telugu / Hindi / English labels where the restaurant lists them.
