"""Lint-style guardrails: tenant isolation must stay impossible to bypass by accident."""
import ast
from pathlib import Path

NOVA = Path(__file__).resolve().parents[1] / "nova"
ALLOWED_RAW = {"tenancy", "app.py", "cli.py"}


def _py(root: Path):
    return [p for p in root.rglob("*.py")]


def test_only_data_layer_imports_motor_or_pymongo_collections():
    offenders = []
    for p in _py(NOVA):
        rel = p.relative_to(NOVA).parts[0]
        if rel in ALLOWED_RAW:
            continue
        tree = ast.parse(p.read_text())
        for n in ast.walk(tree):
            mods = [a.name for a in n.names] if isinstance(n, ast.Import) else ([n.module or ""] if isinstance(n, ast.ImportFrom) else [])
            if any(m.startswith("motor") for m in mods):
                offenders.append(str(p.relative_to(NOVA)))
    assert not offenders, f"motor may only be imported by tenancy/app/cli: {offenders}"


def test_no_private_handle_access_outside_data_layer():
    bad = []
    for p in _py(NOVA):
        if p.relative_to(NOVA).parts[0] == "tenancy":
            continue
        text = p.read_text()
        if "._db" in text.replace("app.state.database", "") or "._c." in text or "._c)" in text:
            bad.append(str(p.relative_to(NOVA)))
    assert not bad, f"raw database handle used outside nova/tenancy: {bad}"


def test_route_modules_never_touch_the_database_object_directly():
    for p in (NOVA / "api").glob("routes_*.py"):
        text = p.read_text()
        assert "app.state.database" not in text, f"{p.name} must use deps.py helpers"
        assert "AsyncIOMotorClient" not in text


def test_all_tenant_collections_have_tenant_first_indexes_or_are_exempt():
    from nova.tenancy.db import TENANT_COLLECTIONS
    # every collection routed through TenantDB is stamped with tenant_id; unique indexes must be tenant-first
    src = (NOVA / "tenancy" / "db.py").read_text()
    import re
    for line in src.splitlines():
        if re.match(r'^\s+("\w+": \[)?\(\[\(', line) and "True)" in line:
            assert '("tenant_id", 1)' in line, f"unique index not tenant-scoped: {line.strip()}"
    assert "tenants" not in TENANT_COLLECTIONS and "platform_users" not in TENANT_COLLECTIONS
