# Nova Console (`apps/ops`)

The control panel for the owner of the Nova Restaurant Platform. From one place the Nova team can:

- add a client restaurant with a 5-step wizard (basics, look and feel with a live phone preview, contact and hours, selling, review) and get a ready-to-send message, QR code and sign-up code for the client;
- change any restaurant's logo, colours, fonts, details, tax, delivery and payment settings;
- store each restaurant's Razorpay keys (write-only, only "set, ending 1234" is ever shown);
- connect Nova's own WhatsApp number and send a test message;
- see sales, orders, health and who changed what; pause, resume and export a restaurant;
- work the list of restaurants that asked about Nova (enquiries) and start onboarding from one.

It is a static website (Vite, React 18, Tailwind 3, the shared Nova preset from `packages/shared`). It talks only to the Nova API under `/v2/platform/*`.

## Run it

```bash
# 1. API with demo data (from the repo root). Prints the logins; the console login is root@nova.test
PORT=8160 python scripts/dev_server.py

# 2. The console
cd apps/ops
npm install
VITE_API_BASE_URL=http://127.0.0.1:8160 npm run dev     # http://127.0.0.1:3002
```

The dev server's WhatsApp and Razorpay are fakes: WhatsApp test messages are printed in its log. Its data lives only while it runs.

## Build and host

```bash
VITE_API_BASE_URL=https://api.your-domain.example npm run build
```

Upload the `dist/` folder to any static host (Netlify, Cloudflare Pages, S3, nginx). Navigation uses the URL hash (`#/restaurants`), so no special rewrite rules are needed. Set `VITE_BASE=./` if you host it in a sub-folder.

On the API server add the console's address to `ALLOWED_ORIGINS`, and keep it on a private address or behind your usual access rules: it is the owner's tool, not for clients.

## Settings

| Variable | Meaning | Default |
|---|---|---|
| `VITE_API_BASE_URL` | Address of the Nova API, no trailing slash | `http://127.0.0.1:8000` |
| `VITE_BASE` | Public path of the site | `/` |

## Signing in

Sign in with a Nova team account (`/v2/platform/auth/login`). The platform token lasts **30 minutes** and cannot be refreshed. It is kept in the browser tab's session storage only. When it runs out the console shows "Please sign in again"; a restaurant that was half-filled in the wizard is kept (also in session storage) and is restored after signing in. Accounts with the `support` role can look and work enquiries but cannot change settings; the console shows a plain message when the server refuses.

## Notes for developers

- Everything restaurant-specific comes from the API; no restaurant is written in code.
- `src/lib/brand.js` holds palettes, curated fonts, contrast checks and the form <-> config mapping. Saving only changes the fields the forms manage; other config (printers, roles, limits) is preserved.
- The logo is uploaded as raw bytes after the restaurant is created (`POST /v2/platform/tenants/{id}/logo`).
- No data is kept outside the API except the wizard draft and the token, both in `sessionStorage`.
