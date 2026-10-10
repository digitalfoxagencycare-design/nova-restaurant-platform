"""Roles map to permission strings. Built-in defaults live here; a tenant owner can adjust POS rules per role
(grant/revoke from a fixed allowlist) and set limits, both validated in the tenant config."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

ALL = "*"

# Everything a tenant may grant or revoke per role. Platform, user-management and config permissions are NOT here,
# so a tenant config can never escalate a role beyond the POS surface.
POS_PERMISSIONS = frozenset({
    "bills.view", "bills.create", "bills.edit", "bills.void_item", "bills.discount", "bills.discount.override",
    "bills.split", "bills.pay", "bills.print", "bills.reprint", "bills.void", "bills.reopen", "bills.refund",
    "menu.view", "menu.edit", "menu.stock", "kitchen.view", "kitchen.update", "reports.view", "tables.edit",
})

_MANAGER_POS = frozenset(POS_PERMISSIONS)
_CASHIER_POS = frozenset({
    "bills.view", "bills.create", "bills.edit", "bills.discount", "bills.split", "bills.pay", "bills.print",
    "menu.view", "kitchen.view", "tables.edit",
})

ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "owner": frozenset({ALL}),
    "manager": _MANAGER_POS | frozenset({
        "orders.view", "orders.create", "orders.update", "orders.refund", "customers.view", "customers.edit",
        "coupons.view", "coupons.edit", "users.view", "config.view",
    }),
    "cashier": _CASHIER_POS | frozenset({"orders.view", "orders.create", "orders.update", "customers.view", "config.view"}),
    "captain": frozenset({"bills.view", "bills.create", "bills.edit", "bills.print", "menu.view", "kitchen.view", "tables.edit", "config.view"}),
    "kitchen": frozenset({"orders.view", "orders.update", "menu.view", "kitchen.view", "kitchen.update"}),
    "delivery": frozenset({"orders.view", "orders.update.delivery"}),
    "viewer": frozenset({"orders.view", "menu.view", "reports.view", "config.view", "bills.view"}),
}
PLATFORM_ROLES = {"platform_admin": frozenset({ALL}), "support": frozenset({"platform.tenants.view", "platform.leads.manage"})}

# Limits that sit next to the permissions. ``None`` means no limit. Tenants override these in config ``pos.limits``.
DEFAULT_LIMITS: dict[str, dict[str, Any]] = {
    "discount_max_pct": {"owner": 100, "manager": 30, "cashier": 10, "captain": 0},
    "refund_max_paise": {"owner": None, "manager": 200_000, "cashier": 0, "captain": 0},
    "reopen_window_minutes": {"owner": None, "manager": 1440, "cashier": 0, "captain": 0},
}


def has_permission(perms: frozenset[str], needed: str) -> bool:
    return ALL in perms or needed in perms


def permissions_for(role: str, platform: bool = False) -> frozenset[str]:
    table = PLATFORM_ROLES if platform else ROLE_PERMISSIONS
    return table.get(role, frozenset())


def effective_permissions(role: str, tenant_config: Mapping[str, Any] | None) -> frozenset[str]:
    """Built-in role permissions with the tenant's ``pos.roles`` grants/revokes applied. The owner is never reduced."""
    base = set(permissions_for(role))
    if role == "owner" or ALL in base:
        return frozenset(base)
    rule = (((tenant_config or {}).get("pos") or {}).get("roles") or {}).get(role) or {}
    base |= {p for p in rule.get("grant", []) if p in POS_PERMISSIONS}
    base -= set(rule.get("revoke", []))
    return frozenset(base)


def limit_for(role: str, name: str, tenant_config: Mapping[str, Any] | None) -> Any:
    """Per-role limit with tenant override. Unknown roles get the strictest default (0)."""
    custom = (((tenant_config or {}).get("pos") or {}).get("limits") or {}).get(name) or {}
    if role in custom:
        return custom[role]
    return DEFAULT_LIMITS[name].get(role, 0)
