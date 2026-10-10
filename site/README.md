# Nova public website

A single-page landing site for restaurant owners, with an enquiry form. Plain HTML, CSS and JavaScript: no build step, no framework, no third-party scripts. Fonts (Bricolage Grotesque, Figtree) come from Google Fonts with a system fallback.

Files: `index.html`, `style.css`, `main.js`, `assets/` (Nova logo and icons copied from `packages/shared/assets/nova-logo.png`).

## 1. Fill in your contact details
Open `main.js`. At the top there is a block marked for the owner:

```js
const CONTACT = {
  whatsapp: "91XXXXXXXXXX",      // country code + number, digits only
  phone: "+91 XXXXX XXXXX",      // shown and dialled
  whatsappText: "Hello Nova, ...",
};
```
While the values still contain `X`, the WhatsApp and phone buttons stay hidden (nothing invented is ever shown). Also replace `91XXXXXXXXXX` in the `<noscript>` block in `index.html` (the note for visitors without JavaScript).

## 2. Set the API address
In `index.html`:

```html
<meta name="nova-api" content="">
```
Empty means the same origin as the page (the site is served under the same domain as the API). Otherwise put the API origin, for example `https://api.example.com` (no trailing slash). The form posts to `<that>/v2/public/leads`. If the site is on a different origin from the API, the API must allow it in `ALLOWED_ORIGINS` (CORS), and the page's CSP `connect-src` must include the API origin.

Enquiries appear in the Nova console: `GET /v2/platform/leads`.

## 3. Host it
Upload the folder to any static host (Cloudflare Pages, Netlify, Vercel, S3 + CDN, nginx). No server code. Serve over HTTPS.

Suggested headers:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://YOUR-API-ORIGIN; base-uri 'none'; form-action 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```
The page has no inline scripts, inline styles or inline event handlers, so this policy works as written. Replace `YOUR-API-ORIGIN` (drop it if the API is the same origin).

## How the form behaves
- Fields: restaurant name, your name, mobile number, city, e-mail (optional), message (optional), plus a hidden `website` honeypot that people never see. Bots that fill it get a normal "ok" from the server and nothing is stored.
- Checks in the browser first (same rules as the server), clear message per field.
- 201: thank-you message. 422: the field named by the server is marked. 429: "try again in an hour" (the server allows 5 enquiries per hour per visitor). Network error or timeout: message with WhatsApp and phone options (when filled in).
- The button is disabled while sending, so it cannot be submitted twice.

## Changing the content
The "coming soon" list (push notifications, loyalty coins, address search) and the FAQ are plain HTML in `index.html`. Keep claims to what the product really does (see `docs/13-client-apps.md` and `docs/14-console-whatsapp-payments.md`). The colour-switch demo palettes are in `style.css` (`.phone[data-palette=...]`).

## Try it locally
```bash
PORT=8170 python scripts/dev_server.py          # API
python3 -m http.server 4175 --directory site    # site, then set the meta tag to http://127.0.0.1:8170
```
(The dev server allows CORS from localhost ports 4170-4189.)
