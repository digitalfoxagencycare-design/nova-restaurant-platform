# 10. Phases 0 and 1 — what was built

## Phase 0 — foundations
| Item | Where |
|---|---|
| Repo layout, `make check`, pre-commit | `Makefile`, `.pre-commit-config.yaml` |
| CI: lint, tests, schema check, secret scan (own scanner + gitleaks over full history), `pip-audit` | `.github/workflows/ci.yml` |
| Dependabot, CODEOWNERS on security-critical paths | `.github/` |
| Secret scanner knowing the shapes that leaked in the source project (Atlas URI with password, Meta `EAA…` token, Razorpay keys, gateway keys, default JWT/passwords) | `scripts/scan_secrets.py` + tests |
| `.env.example` with **no** usable defaults; settings fail loudly if signing keys are missing | `backend/.env.example`, `nova/core/config.py` |
| **Startup safety gate**: production refuses to boot with weak/placeholder JWT keys, debug OTP flags, `*`/http origins, localhost DB, long-lived tokens | `nova/core/startup_checks.py` |
| Contribution rules, security policy | `CONTRIBUTING.md`, `SECURITY.md` |

> **Not done by this work — needs you:** rotating the credentials that are exposed in the *source* project (DB password, WhatsApp token, gateway key, JWT secret). See [08](08-security-findings.md) S1–S5. Nothing in this repo can do that for you.

## Phase 1 — tenancy core
| Item | Where |
|---|---|
| `TenantDB`: every filter forced to the caller's tenant (top-level `tenant_id`; `$or` cannot escape), inserts stamped, `tenant_id` immutable, upserts stamped, aggregations prefixed with `$match` and cross-collection / code-running stages rejected at any depth, JS operators rejected, only registered collections reachable, `delete_many({})` refused | `nova/tenancy/db.py` |
| `PlatformDB` for Nova-level data, separate type, only handed to platform code paths | same |
| Tenant-first (unique-per-tenant) indexes | `ensure_indexes` |
| Tenant config validated by the JSON Schema **plus** business rules (increasing fee slabs, valid windows/flows, loyalty sanity, **secrets rejected inside config**) | `nova/tenancy/config_validation.py` |
| Auth: bcrypt, password rules, JWT with `kid` rotation, `alg` pinning, token-type separation, refresh **rotation with reuse detection** (theft kills the family), lockout, no account enumeration, token version for instant revoke | `nova/core/security.py`, `nova/services/auth.py` |
| Identity only from the signed token; header/query/body can never pick a tenant; suspended tenants die instantly | `nova/api/deps.py` |
| Roles → permissions; `platform.*` and tenant permissions never cross (an owner's `*` doesn't grant platform access) | `nova/core/permissions.py`, `deps.require_permission` |
| Onboarding without seeded passwords: platform admin created via CLI prompt; tenant owner via one-time invite token (only its hash is stored) | `nova/cli.py`, `services/tenants.py` |
| Audit log (tenant) + platform audit | `services/audit.py` |
| Endpoints: `/v2/health`, `/v2/auth/{login,refresh,logout,accept-invite}`, `/v2/tenants/me`, `PUT /v2/tenants/me/config` (optimistic lock), `/v2/users`, `/v2/audit`, `/v2/platform/{auth/login,tenants,tenants/{id}/suspend}` | `nova/api/` |

## Tests (61)
- **Data layer (13):** A can't read, update, delete or aggregate B's rows; `$or`/explicit `tenant_id` tricks return nothing; foreign stamps, `$set tenant_id`, `$rename` onto it, `$where`, `$lookup` inside `$facet` all rejected; same unique key allowed in two tenants but not twice in one.
- **HTTP end-to-end (11 + 7):** two real tenants; header/query tricks ignored; forged token with swapped `tid` rejected; roles enforced; platform/tenant separation; suspension; refresh rotation + replay; lockout; invites single-use; no default accounts; old `/api/setup/seed` absent.
- **Security/startup (20), config (5), scanner (3), architecture guards (4):** key rotation, `alg=none`, tampering; every unsafe production setting refuses to start; secret-shaped values rejected in config; repo scans clean; **no module outside `nova/tenancy` may import Motor or touch the raw handle**.
- **Mutation check:** I deliberately broke isolation twice (removed the tenant filter; let a header override the token's tenant) and confirmed the suite fails each time, then restored the code.

## Dependency finding
The source project pins `fastapi==0.110.1`, which brings an old Starlette with published vulnerabilities, and an old PyMongo. `pip-audit` flagged both while building this repo; requirements here are updated (FastAPI 0.14x, Starlette 1.x, Motor 3.7, PyMongo 4.18) and `pip-audit` now reports **no known vulnerabilities**; CI runs it on every PR. The live HyderabadiIrani backend should get the same upgrade.

## Known limits (honest list)
- Tests run on an in-memory Mongo (`mongomock`). Real-MongoDB behaviour (transactions, index builds, `$and` upsert extraction) must be verified in CI against a Mongo service before the first tenant is migrated — add a `mongo` service container job in Phase 2.
- `_db` / `_c` are Python-private, not hard-private: the architecture tests catch accidental use, not a deliberately hostile contributor. Code review (CODEOWNERS) covers that.
- No rate limiting on `/auth/*` beyond per-account lockout; no MFA yet; no email/WhatsApp delivery of invites (token is returned in the API response for now); cookies not used — bearer tokens only; per-tenant CORS origins not dynamic yet.
- Money still uses plain numbers in config; integer paise arrives with the order engine in Phase 2.

## Next: Phase 2 — port the order engine
`OrderService` (pricing, coupons, loyalty, GST, delivery fee, status flows from tenant config) replaying the source project's ≈59 tests against the Hyderabadi Irani config.
