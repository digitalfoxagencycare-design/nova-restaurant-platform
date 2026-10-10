# Nova customer app

One codebase, two ways to ship it:

1. **The restaurant's website** - a landing page (`/s/<code>/about`, or `/` with `?t=<code>` / `VITE_TENANT`) and the ordering storefront at `/s/<code>`.
2. **The Android customer app** - the same code wrapped by Capacitor, with the restaurant fixed at build time (`VITE_TENANT`). Inside the app the marketing landing is skipped and the menu opens straight away.

Nothing restaurant-specific lives in the code. The app loads `GET /v2/public/{code}/storefront`, calls `applyBrand(brand)` from `@nova/shared`, and only uses the theme tokens (`bg-brand`, `text-brand-on`, `bg-accent`, `text-accent-on`, `bg-accent-soft`, `bg-brand-soft`, `text-ink`, `border-line`, `bg-surface`, `font-display`). Languages come from `locale.languages` (`src/i18n.js` has en / te / hi labels; the switcher only shows when the restaurant lists more than one).

Stack: Vite 5, React 18, Tailwind 3 (preset from `packages/shared`), Capacitor 6. No UI kit, no axios (the shared `createClient` is used).

## Run it

```bash
pip install -r backend/requirements-dev.txt
python scripts/dev_server.py                 # API on :8000, restaurant `demo-biryani`, sign-in codes returned as debug_otp
cd apps/customer
npm install
npm run dev                                  # http://127.0.0.1:3001/s/demo-biryani  (landing: /s/demo-biryani/about)
```

The dev server allows CORS from `127.0.0.1:3000-3010` and `:4170-4189`, so `npm run dev` (3001) and `npm run preview` (4173) both work.

Build time variables (`.env.local`, never committed; see `.env.example`):

| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | API origin, default `http://127.0.0.1:8000` |
| `VITE_TENANT` | Fixed restaurant code (Android build, or a site served on the restaurant's own domain). Empty = read it from the URL |
| `VITE_BASE` | Public base path if the site is not served from `/` (default `/`) |

Restaurant code resolution on the web: first path segment after `/s/`, else `?t=`, else `VITE_TENANT`. Dine-in QR codes can link to `/s/<code>?table=T-04`.

## Website deploy

`npm run build` writes `dist/`. Serve it as a single-page app: every path (`/s/...`) must fall back to `index.html`.

## White-label Android build

Per restaurant, in CI (all inputs come from the tenant record):

```bash
cd apps/customer
export VITE_API_BASE_URL=https://api.example.com   # HTTPS: the WebView runs on https://localhost, so an http API is blocked as mixed content
export VITE_TENANT=<restaurant-code>
export APP_NAME="<Restaurant name>"
node scripts/white-label.mjs        # stamps appId com.nova.<code>, app name, strings.xml (CI checkout only, do not commit)
npm ci
npm run cap:sync                    # vite build + cap sync android
# icon + splash from the restaurant logo:  npx @capacitor/assets generate --android   (needs resources/icon.png and splash.png)
# optional push: copy google-services.json into android/app/ from the CI secret store (git-ignored)
cd android && ./gradlew assembleRelease     # or bundleRelease for the Play Store
# sign with the restaurant's keystore from the CI secret store (apksigner, or a signingConfig reading env vars)
```

What is committed: the generated `android/` project (appId `com.nova.customer`, app name "Restaurant", location permission for "Use my location"). What is never committed: `google-services.json`, keystores (`*.jks`, `*.keystore`), `keystore.properties`, passwords, `local.properties`. `apps/customer/.gitignore` enforces it.

## Behaviour notes

- Orders are cash or UPI on delivery / at the counter (`storefront.payments.online` is false). Each placement attempt carries an `Idempotency-Key`; the key is reused if the same cart is retried after a network failure and replaced when the cart, address or coupon changes.
- Delivery distance is checked from coordinates. When the restaurant has an origin and a radius, the customer must tap "Use my location" (or pick a saved address that has coordinates); the API answers `LOCATION_REQUIRED` otherwise.
- Customer token: `localStorage["nova.customer.<code>"]`. Any 401 clears it and signs the customer out.
- `debug_otp` is only used to pre-fill the code when the API response contains it (development servers).
- Order tracking refreshes every 8 s while the order is active and the tab is visible.

## Layout

```
src/
  main.jsx  App.jsx  state.jsx  i18n.js  index.css
  lib/env.js         restaurant code + location parsing
  lib/errors.js      API error code -> message and next action
  components/ui.jsx  Sheet, Button, Stepper, Banner, Skeleton, icons, PoweredBy
  components/DishArt.jsx   flat SVG dish illustrations + photo fallback
  screens/Landing.jsx  Shell.jsx  Menu.jsx  Checkout.jsx  SignIn.jsx  Orders.jsx  Account.jsx
```
