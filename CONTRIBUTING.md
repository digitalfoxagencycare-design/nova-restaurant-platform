# Working agreements

1. Small pull requests with tests. `make check` must pass locally (lint + secret scan + tests).
2. **Never** access Mongo collections directly in route or service code. Use `TenantDB` (tenant data) or `PlatformDB` (Nova data) from `api/deps.py`. `tests/test_architecture.py` fails if you don't.
3. Every new tenant collection: register it in `TENANT_COLLECTIONS` and give it a tenant-first index in `ensure_indexes`.
4. Identity and tenant come only from the signed token — never from a header, query string or body.
5. Money is computed on the server; amounts will be integer paise in v2 endpoints.
6. No defaults for secrets, no seeded passwords, no public setup endpoints.
