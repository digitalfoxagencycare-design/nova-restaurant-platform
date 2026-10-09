"""The isolation guarantees of TenantDB, tested directly against the data layer."""
import pytest
import pytest_asyncio
from mongomock_motor import AsyncMongoMockClient

from nova.tenancy.db import PlatformDB, TenancyViolation, TenantDB


@pytest_asyncio.fixture
async def dbs():
    raw = AsyncMongoMockClient()["x"]
    a, b = TenantDB(raw, "A"), TenantDB(raw, "B")
    await a.orders.insert_many([{"order_no": "1", "total": 10}, {"order_no": "2", "total": 20}])
    await b.orders.insert_many([{"order_no": "1", "total": 999}, {"order_no": "3", "total": 5}])
    return raw, a, b


async def test_reads_only_see_own_tenant(dbs):
    _, a, b = dbs
    assert await a.orders.count_documents({}) == 2
    assert await b.orders.count_documents({}) == 2
    assert (await a.orders.find_one({"order_no": "1"}))["total"] == 10
    assert (await b.orders.find_one({"order_no": "1"}))["total"] == 999
    assert await a.orders.find_one({"order_no": "3"}) is None  # exists only in B


async def test_or_filter_cannot_escape(dbs):
    _, a, _ = dbs
    docs = [d async for d in a.orders.find({"$or": [{"tenant_id": "B"}, {"order_no": "3"}]})]
    assert docs == []
    docs = [d async for d in a.orders.find({"tenant_id": "B"})]
    assert docs == []


async def test_writes_cannot_touch_other_tenant(dbs):
    raw, a, b = dbs
    res = await a.orders.update_many({}, {"$set": {"total": 0}})
    assert res.modified_count == 2
    assert {d["total"] async for d in raw["orders"].find({"tenant_id": "B"})} == {999, 5}
    res = await a.orders.delete_many({"order_no": {"$in": ["1", "2", "3"]}})
    assert res.deleted_count == 2
    assert await b.orders.count_documents({}) == 2


async def test_empty_delete_many_refused(dbs):
    _, a, _ = dbs
    with pytest.raises(TenancyViolation):
        await a.orders.delete_many({})


async def test_insert_is_stamped_and_foreign_stamp_rejected(dbs):
    raw, a, _ = dbs
    await a.orders.insert_one({"order_no": "9"})
    assert (await raw["orders"].find_one({"order_no": "9"}))["tenant_id"] == "A"
    with pytest.raises(TenancyViolation):
        await a.orders.insert_one({"order_no": "10", "tenant_id": "B"})
    with pytest.raises(TenancyViolation):
        await a.orders.replace_one({"order_no": "1"}, {"order_no": "1", "tenant_id": "B"})


async def test_update_cannot_change_tenant_id(dbs):
    _, a, _ = dbs
    for upd in ({"$set": {"tenant_id": "B"}}, {"$unset": {"tenant_id": ""}}, {"$rename": {"order_no": "tenant_id"}}):
        with pytest.raises(TenancyViolation):
            await a.orders.update_one({"order_no": "1"}, upd)
    with pytest.raises(TenancyViolation):
        await a.orders.update_one({"order_no": "1"}, {"total": 1})  # replacement-style


async def test_upsert_is_stamped(dbs):
    raw, a, _ = dbs
    await a.counters.update_one({"key": "seq"}, {"$inc": {"n": 1}}, upsert=True)
    assert (await raw["counters"].find_one({"key": "seq"}))["tenant_id"] == "A"


async def test_js_operators_rejected(dbs):
    _, a, _ = dbs
    with pytest.raises(TenancyViolation):
        await a.orders.find_one({"$where": "this.total > 0"})
    with pytest.raises(TenancyViolation):
        await a.orders.find_one({"$and": [{"x": {"$function": {}}}]})


async def test_aggregate_is_scoped_and_cross_collection_stages_rejected(dbs):
    _, a, _ = dbs
    out = [d async for d in a.orders.aggregate([{"$group": {"_id": None, "sum": {"$sum": "$total"}}}])]
    assert out[0]["sum"] == 30  # B's 999 and 5 are not included
    for stage in ({"$lookup": {"from": "orders", "localField": "a", "foreignField": "b", "as": "c"}},
                  {"$unionWith": "orders"}, {"$out": "x"}, {"$merge": {"into": "x"}}):
        with pytest.raises(TenancyViolation):
            a.orders.aggregate([stage])
    with pytest.raises(TenancyViolation):  # banned operator nested inside $facet
        a.orders.aggregate([{"$facet": {"f": [{"$lookup": {"from": "orders"}}]}}])


async def test_unregistered_and_platform_collections_unreachable(dbs):
    raw, a, _ = dbs
    for name in ("tenants", "platform_users", "system.users", "nonexistent"):
        with pytest.raises(TenancyViolation):
            getattr(a, name)
    with pytest.raises(TenancyViolation):
        PlatformDB(raw).orders  # noqa: B018


async def test_missing_tenant_id_rejected():
    raw = AsyncMongoMockClient()["y"]
    for bad in ("", None):
        with pytest.raises(TenancyViolation):
            TenantDB(raw, bad)


async def test_same_unique_key_allowed_across_tenants(database):
    a, b = TenantDB(database, "A"), TenantDB(database, "B")
    await a.customers.insert_one({"phone": "9876543210"})
    await b.customers.insert_one({"phone": "9876543210"})  # unique is per tenant
    from pymongo.errors import DuplicateKeyError
    with pytest.raises(DuplicateKeyError):
        await a.customers.insert_one({"phone": "9876543210"})
