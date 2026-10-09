# Security policy

- Report vulnerabilities privately to the repository owner; do not open a public issue.
- Secrets never go in the repo. `scripts/scan_secrets.py` and gitleaks run in CI; a failing scan blocks the merge.
- If a secret is ever committed: **rotate it first**, then remove it. Removing it from the file does not remove it from history.
- Production starts only with strong, non-default signing keys, explicit HTTPS origins and debug switches off
  (`backend/nova/core/startup_checks.py`).
- Tenant isolation is enforced in one module (`backend/nova/tenancy/db.py`) and guarded by tests that must stay green.
