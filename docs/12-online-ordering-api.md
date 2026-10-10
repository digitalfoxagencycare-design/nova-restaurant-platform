# 12. Online ordering, delivery and owner API

A customer order is a **bill with `channel: "online"`**. The kitchen screen, day report, receipts, refunds and printing therefore work for online orders without a second system. The customer-facing life cycle lives in `bill.online.status` and follows the tenant's `operations.flows` for the order type (billing status open/paid/void is separate). Money is integer paise.

## Customer (`/v2/public/{slug}/...` then `/v2/me/...`)
| Call | Notes |
|---|---|
| `GET /public/{slug}/storefront` | brand, languages, order channels, min order, paused + notice, delivery slabs, COD availability, tables. No secrets. |
| `GET /public/{slug}/menu` | categories + items (price in paise, veg, available, description, image). |
| `POST /public/{slug}/quote` | `{type, items:[{item_id,qty,note}], table?, address?{text,lat,lng}, coupon?}` -> totals, delivery fee, distance. Prices are read on the server; the client never sends a price. |
| `POST /public/{slug}/otp/send` / `otp/verify` | phone + 6-digit code. 5 tries, 5 codes per hour. Returns a customer access token (30 days). |
| `GET/PUT/DELETE /me` | profile, saved addresses, account deletion. |
| `POST /me/orders` | same body as quote + `payment:"cod"`, `notes`. `Idempotency-Key` header makes retries safe. |
| `GET /me/orders`, `GET /me/orders/{id}`, `POST /me/orders/{id}/cancel` | tracking: timeline, delivery code, driver name/phone/location once out for delivery. Cancel only while `placed`. |

Stable error codes: `STORE_PAUSED`, `CHANNEL_OFF`, `OUT_OF_STOCK`, `BELOW_MINIMUM`, `OUT_OF_DELIVERY_RANGE`, `LOCATION_REQUIRED`, `ADDRESS_REQUIRED`, `BAD_TABLE`, `COUPON_INVALID`, `COUPON_MIN`, `COD_UNAVAILABLE`, `PAYMENT_NOT_AVAILABLE`, `TOO_MANY_ACTIVE`, `TOO_LATE`, `OTP_INVALID`, `OTP_LOCKED`, `OTP_LIMIT`, `OTP_NOT_CONFIGURED`.

## Restaurant staff (owner/manager/cashier; permission in brackets)
`GET /orders?scope=open|done|cancelled|all&channel=all|online|pos` [orders.view] · `GET /orders/{id}` · `POST /orders/{id}/status {status, reason?, collect?{mode,ref}}` [orders.update] · `POST /orders/{id}/assign {driver_id}` · `GET /delivery/drivers` · `GET/PUT /store {paused, notice, auto_accept}` · `GET /overview` [reports.view] · `GET /customers?q=` [customers.view] · `GET/POST /coupons`, `PATCH/DELETE /coupons/{id}` [coupons.view/edit] · `GET /tables` · `PATCH /users/{id}` [users.manage] · `POST /pos/menu/bulk-availability`, `POST /pos/menu/bulk-price`.

Status moves one step along the flow. Cancelling needs a reason and is refused once the order is out for delivery. Closing an unpaid order (`completed`/`delivered`) needs `collect`, otherwise `PAYMENT_DUE`.

## Delivery partner (`/v2/delivery/...`, permission `orders.update.delivery`)
`GET /orders` -> `{pickup, active, history}` · `POST /orders/{id}/accept` (first writer wins, others get `TAKEN`) · `POST /location` · `POST /orders/{id}/delivered {code, collected_mode?}` (customer's 4-digit code, 5 tries; collects cash/UPI when payment is due) · `GET /summary?range=today|7d|30d|all` (deliveries, distance, cash, earnings from `delivery.driver_pay`).

## Tenant config added
`delivery.origin {lat,lng}`, `delivery.driver_pay {base, per_km}`, `ordering.paused|notice|auto_accept|prep_minutes`, `brand.address|hours|hero_image_url|map_url|social`.

## Not in this version (be honest with clients)
Online card/UPI payment at checkout (cash or UPI on delivery only; a Razorpay provider per tenant is the next step), sending the OTP over WhatsApp/SMS (plug an `OtpSender` into `app.state.otp_sender`; production refuses to send without one), push notifications, loyalty coins and first-order offers, delivery-partner payouts.
