"""Roles map to permission strings. Roles are data in v2 (custom roles); these are the built-in defaults."""
from __future__ import annotations

ALL = "*"

ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "owner": frozenset({ALL}),
    "manager": frozenset({
        "orders.view", "orders.create", "orders.update", "orders.refund", "menu.view", "menu.edit",
        "customers.view", "customers.edit", "coupons.view", "coupons.edit", "reports.view", "tables.edit",
        "users.view", "config.view",
    }),
    "cashier": frozenset({"orders.view", "orders.create", "orders.update", "menu.view", "customers.view", "tables.edit", "config.view"}),
    "kitchen": frozenset({"orders.view", "orders.update", "menu.view"}),
    "delivery": frozenset({"orders.view", "orders.update.delivery"}),
    "viewer": frozenset({"orders.view", "menu.view", "reports.view", "config.view"}),
}
PLATFORM_ROLES = {"platform_admin": frozenset({ALL}), "support": frozenset({"platform.tenants.view"})}


def has_permission(perms: frozenset[str], needed: str) -> bool:
    return ALL in perms or needed in perms


def permissions_for(role: str, platform: bool = False) -> frozenset[str]:
    table = PLATFORM_ROLES if platform else ROLE_PERMISSIONS
    return table.get(role, frozenset())
