# Nova Restaurant Platform

One **master Nova operations dashboard** and a family of **mobile apps** that any restaurant (or similar food / appointment-style business) can run on, configured per business instead of re-coded.

Derived from a real, working single-restaurant system (`HyderabadiIrani`): storefront, POS, kitchen display, delivery app, customer app, loyalty, coupons, GST reports, WhatsApp OTP/updates. This repo turns it into a **multi-tenant, configurable product**.

> Status: **Phases 0–1 done** (foundations + tenancy core, 61 tests). Analysis, plan and design prototype are in `docs/` and `design/`. No source-project code has been copied; nothing here contains credentials.

## Read in this order
| # | Doc | What it answers |
|---|---|---|
| 1 | [docs/01-source-analysis.md](docs/01-source-analysis.md) | What the source project contains and how it works |
| 2 | [docs/02-standardization.md](docs/02-standardization.md) | What is hard-coded to one restaurant → which config key replaces it |
| 3 | [docs/03-target-architecture.md](docs/03-target-architecture.md) | The multi-tenant platform, apps and services |
| 4 | [docs/04-data-model.md](docs/04-data-model.md) | Collections, tenant scoping, indexes |
| 5 | [docs/05-api-v2.md](docs/05-api-v2.md) | v1 → v2 API map |
| 6 | [docs/06-mobile-apps.md](docs/06-mobile-apps.md) | Master mobile app + white-label apps |
| 7 | [docs/07-roadmap.md](docs/07-roadmap.md) | Phases with exit criteria |
| 8 | [docs/08-security-findings.md](docs/08-security-findings.md) | Issues found in the source that must not be inherited |
| 9 | [docs/09-fit-check.md](docs/09-fit-check.md) | Which businesses fit, and an onboarding questionnaire |
| 10 | [docs/10-phase-0-1.md](docs/10-phase-0-1.md) | What phases 0 and 1 built |
| 11 | [docs/11-pos-printing-permissions.md](docs/11-pos-printing-permissions.md) | POS, billing, TVS/ESC-POS printing, role rules and approvals |

Design prototype: [`design/master-dashboard.html`](design/master-dashboard.html) (open in a browser; sample data).
Config schema: [`config/tenant.schema.json`](config/tenant.schema.json) and an example derived from the source: [`config/tenants/hyderabadi-irani.example.json`](config/tenants/hyderabadi-irani.example.json).

## Principles
1. **Config over code.** Everything business-specific (tax, fees, hours, loyalty, brand) lives in tenant config.
2. **One tenant boundary, enforced in one place.** Every query is scoped by `tenant_id` through a single data-access layer, never by hand.
3. **Server decides money.** Prices, discounts, tax and totals are computed server-side (the source already does this well).
4. **Offline-first at the counter.** Billing keeps working without internet and syncs idempotently.
5. **No secrets in the repo.** Ever. Environment / secret manager only.

## Run it
```bash
make install          # backend dependencies
make check            # lint + secret scan + 61 tests
cp backend/.env.example backend/.env   # then put real random keys in it
python -m nova.cli create-platform-admin --email you@example.com   # prompts for a password; none is ever seeded
make run              # API docs: http://localhost:8000/docs   POS web app: http://localhost:8000/app/
```
What exists today: tenant model + validated config, a data layer that makes cross-tenant access impossible, login with
refresh-token rotation, roles/permissions, invite-based onboarding, audit log, startup safety checks. See
[docs/10-phase-0-1.md](docs/10-phase-0-1.md).
