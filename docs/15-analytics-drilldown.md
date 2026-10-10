# 15. Analytics drill-down (click a chart, go one layer deeper)

One small engine answers "how much, split by what, for which slice" for one restaurant or, for the Nova team, for every restaurant. It reads the bills (money is integer paise), so the numbers always agree with the POS, the day report and the CSV.

## The idea
1. **Breakdown**: split a measure (sales, orders, average bill, items, discounts, GST) by one dimension (day, hour, channel, payment mode, dish ...).
2. **Click a slice, bar, legend row or table row**: that adds a filter such as `channel:online` and the next breakdown is computed *inside* that slice. The panel picks the next dimension from `suggested_path` (channel, order type, payment mode, category, dish); the person can change it with "Split by".
3. **Show bills** lists the real bills behind any slice (50 per page, newest or highest first).
4. **Click a bill** to open all of it: items with notes, money, every payment (mode, reference, time, who), refunds, customer, rider, online timeline, activity log (who did what, including kitchen tickets).
5. **Download CSV** gives the same bills for the current filters.

## API
Restaurant staff with `reports.view`: `/v2/analytics/...`. Nova team (`platform.tenants.view`): `/v2/platform/analytics/...` (same shape plus the `restaurant` dimension; CSV export is written to the platform audit log).

| Call | Returns |
|---|---|
| `GET /meta` | `dimensions` (key, label, kind, `time`), `measures`, `suggested_path` |
| `GET /breakdown?by=channel&from=2026-10-01&to=2026-10-07&f=type:Delivery&f=payment_mode:upi&scope=sales&compare=true` | `rows` (key, label, sales, orders, avg_bill, items, discount, tax, share), `totals`, `previous` (same totals for the period before), `truncated` |
| `GET /records?...same filters...&limit=50&offset=0&sort=created_at\|total\|net` | `total_count`, `summary`, `rows` (one per bill) |
| `GET /records.csv?...same filters...` | spreadsheet file, formulas defused, `X-Truncated` header |
| `GET /v2/orders/{id}` | one bill in full (counter or online), including `history`; needs `orders.view` |
| `GET /v2/pos/bills/{id}` | the same bill from the POS side; needs `bills.view` (the panel falls back to it) |
| `GET /v2/platform/analytics/bill/{restaurant_id}/{id}` | one bill in full for the Nova team |

Filters are repeated `f=dimension:value` and are ANDed. `scope=sales` (default) counts paid and refunded bills; `scope=all` also includes open and void bills. At most 366 days and 8 filters per call. Day, hour (`13`), weekday (`0`=Monday), month (`2026-10`) are time dimensions: gaps are filled with zero rows so charts have no holes.

Notes on the numbers: a *dish* or *category* row counts each line, so a bill with several dishes appears under each; a split payment appears under every mode used. Refunds are subtracted from the mode they went back through. Online payments through Razorpay are stored with the mode `online`; pay-on-delivery orders show the mode collected (cash, UPI or card).

## The web panel (`web/drill.js`)
`Drill.create({ prefix, mode, canOpenBill, openBill, state })` returns `{ el, load }`. `state` is a plain object that is mutated, so it survives a screen redraw; set `by`, `filters: [{dim, value, label}]`, `measure`, `scope`, `preset` (`today`, `7d`, `30d`, `month`, `custom`) or `from`/`to` to open it already drilled in. `openReport(init)` does that for the Reports screen (used by the dashboard tiles, bars and cards). The Reports screen needs `reports.view`; a user without it keeps the old dashboard.

Charts are inline SVG built with DOM calls; server text never goes through `innerHTML`. Every slice, bar, point and legend row is a button: arrow keys move between points, Enter or Space drills in, each has an `aria-label` with the value and share.

## Add a dimension
1. `backend/nova/services/analytics.py`: add it to `DIMENSIONS` (`"label", kind`). Kinds: `bill` (one value per bill: also add its `(key, label)` in `bill_dims`), `line` (one value per dish line: add it in `line_dims`), `payment` (one per payment mode).
2. If it is a time dimension, add it to `TIME_DIMS` and, if gaps should be filled, to `finish`.
3. Optionally add it to `suggested_path` in `routes_analytics._meta`.
4. Add a test in `backend/tests/test_analytics.py`. The web panel picks it up from `/meta` with no change.

## Try it locally
`python scripts/dev_server.py` seeds `demo-biryani` with about 600 varied bills over 60 days (dine-in, takeaway, delivery, online orders, cash/UPI/card/online/pay-on-delivery, split payments, WELCOME10, discounts, refunds, voids, riders) and a small second restaurant `demo-chai` (login `chai@demo.test`) so the platform view has something to split by. Open `/app/`, log in as `owner@demo.test` (restaurant `demo-biryani`) and open Reports or click any dashboard tile.

## Known limits
Reads the bills of the chosen days into memory (cap 50,000 bills, reported as `truncated`); fine for one restaurant for a year. The date presets use the browser's calendar day, which can differ from the restaurant's business day between midnight and the day-start time.
