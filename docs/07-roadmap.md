# 7. Roadmap

| Phase | Goal | Deliverables | Exit criteria |
|---|---|---|---|
| **0 — Foundations** (1–2 wks) | Safe base | Repo, CI, lint/test, secret scanning, environments; **rotate leaked credentials in the source project** ([08](08-security-findings.md)); module skeleton | CI green; no secrets in history of this repo |
| **1 — Tenancy core** (2–3 wks) | One DB, many tenants | `tenants`, `outlets`, tenant config + schema validation, data-access layer, auth with `tenant_id`, audit log | Cross-tenant access tests all fail closed |
| **2 — Port the order engine** (3 wks) | Same behaviour, now configurable | `OrderService`, promotions, loyalty, status flows from config; money in paise; golden tests replaying the source's tests | Source's ≈59 backend tests pass against v2 with the Hyderabadi Irani config |
| **3 — Restaurant console + POS + KDS** (4 wks) | Staff can run a day | Console (menu, orders, tables, staff, offers, customers), POS with offline sync, kitchen display on WebSocket, printing | Pilot outlet runs a full day in parallel with the old system |
| **4 — Master console** (3 wks) | Nova sees everything | Overview, tenants, usage/costs, ads (Meta/Google read-only), health, onboarding wizard | Real data for the pilot tenant; cost per order visible |
| **5 — Mobile** (4–6 wks) | Apps | Nova Owner app, white-label customer app pipeline, delivery app | Two tenants shipped from one codebase |
| **6 — Migration & launch** | Move the first restaurant | Import tool, cut-over plan, backups, runbooks | First tenant live; rollback tested |
| **7 — Grow** | Fit more businesses | WhatsApp ordering bot, inventory, reservations, aggregator inbox, subscriptions & billing | Second business type onboarded in < 1 day |

## Working agreements
Small PRs; every PR has tests; every endpoint scoped by tenant; no secrets; docs updated with code; demo at the end of each phase.
