# Nova Delivery (delivery partner app)

Vite + React 18 + Tailwind 3 + Capacitor 6. One codebase for every restaurant: the colours, fonts and name come from
`GET /v2/public/{code}/storefront` through `applyBrand` in `@nova/shared`.

## Run
```bash
python scripts/dev_server.py            # API on :8000, restaurant code demo-biryani (logins are printed)
cd apps/delivery && npm install
npm run dev                             # http://127.0.0.1:5174
npm run build                           # dist/
```
Demo rider: `rider@demo.test` / `rider2@demo.test`, restaurant code `demo-biryani`.

## Environment
| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | API server (default `http://127.0.0.1:8000`) |
| `VITE_TENANT` | Fix the restaurant for a per-restaurant build. The Restaurant code field is hidden. Without it the code is typed at sign-in and remembered on the device. |

For a browser test build that talks to another port, note that the dev API only allows origins on ports 3000-3010 and 4170-4189 (`npm run preview` uses 4174).

## White-label / Android build
1. Set `VITE_TENANT` and `VITE_API_BASE_URL`, then `npm run build`.
2. Set `appId` (`com.nova.<code>`) and `appName` in `capacitor.config.json`.
3. `npx cap sync android`, open `android/` in Android Studio (or build in CI).
The `android/` project is committed without `google-services.json`, keystores or passwords; add those from the CI secret store.
Add the location permissions to `AndroidManifest.xml` if `cap sync` has not (ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION).

## What it does
Sign in (refresh token used once on a 401, then sign out), Online/Offline switch (location every 10 s through Capacitor Geolocation,
browser fallback; switching off posts `online:false` once), today stats, active deliveries and the ready-for-pickup pool (polled every 10 s),
accept (handles `TAKEN`), order screen with 3-step progress, navigate, call, amount to collect, delivery code + cash/UPI confirmation
(`WRONG_CODE`, `CODE_LOCKED`, `PAYMENT_DUE`), history with date ranges, profile with earnings summary and sign out.

## Not included
Push notifications and background location when the app is closed (location is shared only while the app is open), payouts,
a rider name from the server (the sign-in email is shown because there is no staff `/me` endpoint), offline queueing, i18n.
