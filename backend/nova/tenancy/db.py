"""The one place tenant isolation is enforced.

Route handlers never touch Motor directly. They receive a ``TenantDB`` bound to the caller's tenant,
and every operation on it is rewritten so it can only see and write that tenant's documents:

* filters get ``tenant_id`` forced at top level (implicit AND): a caller's ``$or`` cannot escape it
* inserts are stamped with ``tenant_id`` (a different value in the document is an error)
* updates/replacements may not touch ``tenant_id``; upserts are stamped via ``$setOnInsert``
* aggregations get a leading ``$match`` on ``tenant_id``; stages that can read other collections
  or run code (``$lookup``, ``$unionWith``, ``$out``, ``$function`` ...) are rejected
* server-side JavaScript operators (``$where``, ``$function``, ``$accumulator``) are rejected anywhere
* only collections registered in ``TENANT_COLLECTIONS`` are reachable
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

TENANT_FIELD = "tenant_id"

# Collections that hold tenant data. Anything else is unreachable through TenantDB.
TENANT_COLLECTIONS = frozenset({
    "outlets", "users", "sessions", "customers", "menu_items", "orders", "coupons", "tables",
    "loyalty_transactions", "payment_logs", "login_attempts", "otp_verifications",
    "driver_locations", "device_tokens", "counters", "usage_events", "audit_log", "rollups", "invites",
    "bills", "kot_tickets", "approvals", "idempotency",
})

FORBIDDEN_OPERATORS = frozenset({"$where", "$function", "$accumulator", "$expr_js"})
FORBIDDEN_STAGES = frozenset({
    "$lookup", "$graphLookup", "$unionWith", "$out", "$merge", "$collStats", "$indexStats",
    "$currentOp", "$listSessions", "$planCacheStats",
})


class TenancyViolation(Exception):
    """Raised when a query tries to cross (or hide from) the tenant boundary."""


def _walk(obj: Any, banned: frozenset[str]) -> None:
    if isinstance(obj, Mapping):
        for k, v in obj.items():
            if isinstance(k, str) and k in banned:
                raise TenancyViolation(f"operator {k} is not allowed")
            _walk(v, banned)
    elif isinstance(obj, list | tuple):
        for v in obj:
            _walk(v, banned)


def _check_filter(flt: Mapping[str, Any] | None) -> dict[str, Any]:
    flt = dict(flt or {})
    _walk(flt, FORBIDDEN_OPERATORS)
    return flt


def _check_update(update: Mapping[str, Any]) -> dict[str, Any]:
    update = dict(update)
    if not update:
        raise TenancyViolation("empty update")
    if not any(str(k).startswith("$") for k in update):
        raise TenancyViolation("replacement-style update is not allowed here; use replace_one")
    _walk(update, FORBIDDEN_OPERATORS)
    for op, body in update.items():
        if isinstance(body, Mapping):
            if TENANT_FIELD in body:
                raise TenancyViolation(f"{op} may not modify {TENANT_FIELD}")
            if op == "$rename" and TENANT_FIELD in body.values():
                raise TenancyViolation("cannot rename onto tenant_id")
    return update


class TenantCollection:
    """A Motor collection that can only see one tenant."""

    def __init__(self, coll, tenant_id: str):
        if not tenant_id or not isinstance(tenant_id, str):
            raise TenancyViolation("a tenant id is required")
        self._c = coll
        self.tenant_id = tenant_id

    # ---- helpers
    def _scope(self, flt: Mapping[str, Any] | None) -> dict[str, Any]:
        flt = _check_filter(flt)
        if TENANT_FIELD in flt:
            # the caller mentioned tenant_id at top level: AND it with ours (can only narrow, never widen)
            return {"$and": [{TENANT_FIELD: self.tenant_id}, flt]}
        # Top-level keys are implicitly ANDed, so even a top-level $or in ``flt`` cannot escape this.
        # (Flat form also lets upserts copy equality fields into the new document.)
        return {**flt, TENANT_FIELD: self.tenant_id}

    def _stamp(self, doc: Mapping[str, Any]) -> dict[str, Any]:
        doc = dict(doc)
        _walk(doc, FORBIDDEN_OPERATORS)
        if TENANT_FIELD in doc and doc[TENANT_FIELD] != self.tenant_id:
            raise TenancyViolation("document belongs to a different tenant")
        doc[TENANT_FIELD] = self.tenant_id
        return doc

    # ---- reads
    async def find_one(self, flt=None, *args, **kw):
        return await self._c.find_one(self._scope(flt), *args, **kw)

    def find(self, flt=None, *args, **kw):
        return self._c.find(self._scope(flt), *args, **kw)

    async def count_documents(self, flt=None, **kw):
        return await self._c.count_documents(self._scope(flt), **kw)

    async def distinct(self, key, flt=None, **kw):
        return await self._c.distinct(key, self._scope(flt), **kw)

    def aggregate(self, pipeline: list[dict[str, Any]], **kw):
        # banned names are rejected at ANY depth (e.g. a $lookup hidden inside $facet)
        _walk(pipeline, FORBIDDEN_OPERATORS | FORBIDDEN_STAGES)
        return self._c.aggregate([{"$match": {TENANT_FIELD: self.tenant_id}}, *pipeline], **kw)

    # ---- writes
    async def insert_one(self, doc, **kw):
        return await self._c.insert_one(self._stamp(doc), **kw)

    async def insert_many(self, docs, **kw):
        return await self._c.insert_many([self._stamp(d) for d in docs], **kw)

    async def update_one(self, flt, update, upsert=False, **kw):
        update = _check_update(update)
        if upsert:
            update = {**update, "$setOnInsert": {**update.get("$setOnInsert", {}), TENANT_FIELD: self.tenant_id}}
        return await self._c.update_one(self._scope(flt), update, upsert=upsert, **kw)

    async def update_many(self, flt, update, **kw):
        return await self._c.update_many(self._scope(flt), _check_update(update), **kw)

    async def find_one_and_update(self, flt, update, upsert=False, **kw):
        update = _check_update(update)
        if upsert:
            update = {**update, "$setOnInsert": {**update.get("$setOnInsert", {}), TENANT_FIELD: self.tenant_id}}
        return await self._c.find_one_and_update(self._scope(flt), update, upsert=upsert, **kw)

    async def replace_one(self, flt, doc, upsert=False, **kw):
        return await self._c.replace_one(self._scope(flt), self._stamp(doc), upsert=upsert, **kw)

    async def delete_one(self, flt, **kw):
        return await self._c.delete_one(self._scope(flt), **kw)

    async def delete_many(self, flt, **kw):
        # an empty filter would delete the whole tenant; require the caller to be explicit
        if not flt:
            raise TenancyViolation("delete_many needs a non-empty filter")
        return await self._c.delete_many(self._scope(flt), **kw)


class TenantDB:
    """Attribute access to the registered tenant collections, bound to one tenant."""

    def __init__(self, database, tenant_id: str):
        if not tenant_id:
            raise TenancyViolation("a tenant id is required")
        self._db = database
        self.tenant_id = tenant_id

    def __getattr__(self, name: str) -> TenantCollection:
        if name.startswith("_") or name not in TENANT_COLLECTIONS:
            raise TenancyViolation(f"collection '{name}' is not a tenant collection")
        return TenantCollection(self._db[name], self.tenant_id)


class PlatformDB:
    """Un-scoped access for Nova-level data (tenants, platform users). Only platform principals get one."""

    PLATFORM_COLLECTIONS = frozenset({"tenants", "platform_users", "platform_audit"})

    def __init__(self, database):
        self._db = database

    def __getattr__(self, name: str):
        if name.startswith("_") or name not in self.PLATFORM_COLLECTIONS:
            raise TenancyViolation(f"collection '{name}' is not a platform collection")
        return self._db[name]


async def ensure_indexes(database) -> None:
    """tenant_id is always the first key. Uniqueness is per tenant, never global."""
    spec = {
        "users": [([("tenant_id", 1), ("email", 1)], True)],
        "customers": [([("tenant_id", 1), ("phone", 1)], True)],
        "orders": [
            ([("tenant_id", 1), ("order_no", 1)], True),
            ([("tenant_id", 1), ("outlet_id", 1), ("created_at", -1)], False),
            ([("tenant_id", 1), ("status", 1), ("created_at", 1)], False),
        ],
        "menu_items": [([("tenant_id", 1), ("category", 1), ("available", 1)], False)],
        "coupons": [([("tenant_id", 1), ("code", 1)], True)],
        "tables": [([("tenant_id", 1), ("outlet_id", 1), ("table_no", 1)], True)],
        "outlets": [([("tenant_id", 1), ("name", 1)], True)],
        "sessions": [([("tenant_id", 1), ("jti", 1)], True)],
        "invites": [([("tenant_id", 1), ("token_hash", 1)], True)],
        "counters": [([("tenant_id", 1), ("key", 1)], True)],
        "audit_log": [([("tenant_id", 1), ("ts", -1)], False)],
        "bills": [([("tenant_id", 1), ("bill_no", 1)], True), ([("tenant_id", 1), ("status", 1), ("created_at", -1)], False),
                  ([("tenant_id", 1), ("channel", 1), ("online.status", 1)], False)],
        "kot_tickets": [([("tenant_id", 1), ("bill_id", 1), ("batch", 1)], True), ([("tenant_id", 1), ("status", 1), ("created_at", 1)], False)],
        "approvals": [([("tenant_id", 1), ("jti", 1)], True)],
        "otp_verifications": [([("tenant_id", 1), ("phone", 1)], False)],
        "idempotency": [([("tenant_id", 1), ("key", 1)], True)],
    }
    for coll, idx in spec.items():
        for keys, unique in idx:
            await database[coll].create_index(keys, unique=unique)
    await database["tenants"].create_index([("slug", 1)], unique=True)
    await database["platform_users"].create_index([("email", 1)], unique=True)
