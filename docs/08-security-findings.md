# 8. Security findings in the source project

Found while reading `HyderabadiIrani` (private repo, commit `4b57b42`). **No secret values are reproduced here.** These are things the platform must *not* inherit, and some need action on the live system now.

## 8.1 Act now (live system)
| # | Finding | Where | Action |
|---|---|---|---|
| S1 | **Database credentials hard-coded as default connection strings** in 15 scripts (a MongoDB Atlas user + password) | `backend/seed_full_menu.py`, `scripts/{verify_db, seed_mongodb_menu, finish_combos_tea, insert_to_menu_items, generate_tea_snacks_fast, finish_remaining_4, find_missing_images, add_tiffins, generate_tea_snacks_reliable, sync_menu_to_json, inspect_all_items, generate_tea_snacks_vertex, update_combos_and_tea_images, add_sweets_and_snacks}.py` | **Rotate that DB user's password now**, restrict Atlas network access, remove literals, load from environment. Git history still contains it — treat it as exposed. |
| S2 | **Meta WhatsApp access token, phone-number id, WABA id and Nova-gateway client key as code defaults** | `backend/whatsapp_service.py` | **Revoke/rotate the token and the gateway key**, move to environment/secret manager. |
| S3 | **Default JWT signing secret in code** (and the same value in compose) — if the env var is missing, anyone can forge admin tokens | `backend/server.py`, `docker-compose.yml` | Fail to start when `JWT_SECRET` is unset; rotate the production secret. |
| S4 | **Default admin/staff/driver passwords and DB root password in compose**; `ALLOWED_ORIGINS: "*"` | `docker-compose.yml` | Change any account that used these; never ship defaults. |
| S5 | **Public `/api/setup/seed` (GET and POST)** re-seeds data, **re-applies seeded user passwords from env**, and returns the staff/admin/driver emails | `server.py` ~3543 | Remove, or require a one-time bootstrap token; disable in production now. |

## 8.2 Fix in the platform design
| # | Finding | Fix |
|---|---|---|
| S6 | `PUT /tables/{no}/status` has **no authentication**; `/tables` routes are defined twice (the later definition wins) | Auth + role check; one definition; tenant/outlet scope. |
| S7 | `POST /payments/log-attempt` is unauthenticated and writes to the DB | Rate-limit, bind to an order token, size limits. |
| S8 | CORS regex allows **any `*.run.app` origin** with credentials | Explicit per-tenant origins only. |
| S9 | Access tokens live **30 days**; cookies `SameSite=None` | 15–60 min access + rotating refresh; `SameSite=Lax/Strict` where possible. |
| S10 | **No Razorpay webhook** — payment confirmation depends on the client calling `/verify` | Add signed webhook as the source of truth; reconcile pending payments. |
| S11 | `DEBUG_OTP` returns the OTP in the API response; `ALLOW_TEST_OTP` accepts `123456` | Compile out in production builds; startup check refuses these flags when `ENV=production`. |
| S12 | `/stats` loads up to 2,000 orders in memory per request | Aggregation + rollups ([04](04-data-model.md)). |
| S13 | Money stored as floats | Integer paise. |
| S14 | Firebase `google-services.json` committed (three copies, one with a space in its name) | Not secret by itself, but restrict API keys by app/package; keep per-tenant files in CI secrets. |
| S15 | Agent tooling files committed (`.emergent/`, `.gitconfig`) | Exclude from the new repo. |
| S16 | Everything is single-tenant: any admin sees all data | Tenant boundary in the data-access layer ([03](03-target-architecture.md)). |

## 8.3 Checklist for this repo
- [ ] Secret scanning + push protection enabled.
- [ ] `.env.example` only; real values in a secret manager.
- [ ] Startup self-check: refuses to run in production with default/empty secrets or debug flags.
- [ ] Dependency scanning; pinned versions; SBOM.
- [ ] Cross-tenant test suite in CI.
- [ ] Backups + restore drill before the first tenant is migrated.
