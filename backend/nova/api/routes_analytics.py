"""Drill-down analytics API. Same shape for one restaurant (``/v2/analytics``) and for the whole platform (``/v2/platform/analytics``).

GET .../meta                      what can be split by, what is measured
GET .../breakdown?by=channel&f=type:Delivery&from=&to=   rows for a chart or table (+ totals, previous period)
GET .../records?f=channel:online&f=day:2026-10-05         the bills behind any slice
GET .../records.csv                                       the same bills as a spreadsheet file
"""

from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response

from ..core.errors import ApiError, bad_request, not_found
from ..services import analytics as an
from ..services import online as online_svc
from ..services.audit import platform_audit
from ..services.billing import _load, business_date
from ..tenancy.db import PlatformDB
from .deps import Principal, get_platform_db, require_permission, tenant_db_for

tenant_router = APIRouter(prefix="/v2/analytics")
platform_router = APIRouter(prefix="/v2/platform/analytics")
CSV_CAP = 20_000


def _meta(multi: bool) -> dict:
    dims = [{"key": k, "label": v[0], "kind": v[1], "time": k in an.TIME_DIMS} for k, v in an.DIMENSIONS.items() if multi or k != "restaurant"]
    return {
        "dimensions": dims,
        "measures": [{"key": k, "label": v} for k, v in an.MEASURES.items()],
        "suggested_path": ["channel", "type", "payment_mode", "category", "item"]
        if not multi
        else ["restaurant", "channel", "type", "payment_mode", "category"],
    }


def _allowed(multi: bool) -> set[str]:
    return set(an.DIMENSIONS) - (set() if multi else {"restaurant"})


class Query_:
    """Common query parameters, validated once."""

    def __init__(self, frm: str | None, to: str | None, scope: str, f: list[str] | None, multi: bool, today: str):
        if scope not in ("sales", "all"):
            raise bad_request("BAD_SCOPE", "scope is sales or all")
        self.frm, self.to = an.parse_range(frm, to, today)
        self.scope = scope
        self.filters = an.parse_filters(f, _allowed(multi))
        self.multi = multi


# ------------------------------------------------------------------ one restaurant
async def _tenant_sources(request: Request, p: Principal) -> list[an.Source]:
    cfg = p.config
    return [an.Source(p.tenant_id, cfg["brand"]["name"], cfg["locale"]["timezone"], tenant_db_for(request, p.tenant_id), cfg["tax"]["mode"] == "exclusive")]


@tenant_router.get("/meta")
async def tenant_meta(_: Principal = Depends(require_permission("reports.view"))):
    return _meta(False)


@tenant_router.get("/breakdown")
async def tenant_breakdown(
    request: Request,
    by: str = Query("day"),
    frm: str | None = Query(None, alias="from"),
    to: str | None = None,
    scope: str = "sales",
    f: list[str] | None = Query(None),
    compare: bool = True,
    p: Principal = Depends(require_permission("reports.view")),
):
    return await _breakdown(await _tenant_sources(request, p), by, Query_(frm, to, scope, f, False, business_date(p.config)), compare)


@tenant_router.get("/records")
async def tenant_records(
    request: Request,
    frm: str | None = Query(None, alias="from"),
    to: str | None = None,
    scope: str = "sales",
    f: list[str] | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort: str = "created_at",
    p: Principal = Depends(require_permission("reports.view")),
):
    return await _records(await _tenant_sources(request, p), Query_(frm, to, scope, f, False, business_date(p.config)), limit, offset, sort)


@tenant_router.get("/records.csv")
async def tenant_csv(
    request: Request,
    frm: str | None = Query(None, alias="from"),
    to: str | None = None,
    scope: str = "sales",
    f: list[str] | None = Query(None),
    p: Principal = Depends(require_permission("reports.view")),
):
    return await _csv(await _tenant_sources(request, p), Query_(frm, to, scope, f, False, business_date(p.config)))


# ------------------------------------------------------------------ whole platform
async def _platform_sources(request: Request, pdb: PlatformDB, filters: list[tuple[str, str]] | None = None) -> list[an.Source]:
    only = {v for d, v in (filters or []) if d == "restaurant"}
    out = []
    async for t in pdb.tenants.find({}):
        if only and t["_id"] not in only:
            continue
        cfg = t["config"]
        out.append(an.Source(t["_id"], cfg["brand"]["name"], cfg["locale"]["timezone"], tenant_db_for(request, t["_id"]), cfg["tax"]["mode"] == "exclusive"))
    return out


def _today_utc_plus() -> str:
    from datetime import UTC, datetime, timedelta

    return (datetime.now(UTC) + timedelta(hours=5, minutes=30)).date().isoformat()  # Nova runs in India; per-restaurant days are exact in the data


@platform_router.get("/meta")
async def platform_meta(_: Principal = Depends(require_permission("platform.tenants.view"))):
    return _meta(True)


@platform_router.get("/breakdown")
async def platform_breakdown(
    request: Request,
    by: str = Query("day"),
    frm: str | None = Query(None, alias="from"),
    to: str | None = None,
    scope: str = "sales",
    f: list[str] | None = Query(None),
    compare: bool = True,
    pdb: PlatformDB = Depends(get_platform_db),
    _: Principal = Depends(require_permission("platform.tenants.view")),
):
    q = Query_(frm, to, scope, f, True, _today_utc_plus())
    return await _breakdown(await _platform_sources(request, pdb, q.filters), by, q, compare)


@platform_router.get("/records")
async def platform_records(
    request: Request,
    frm: str | None = Query(None, alias="from"),
    to: str | None = None,
    scope: str = "sales",
    f: list[str] | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort: str = "created_at",
    pdb: PlatformDB = Depends(get_platform_db),
    _: Principal = Depends(require_permission("platform.tenants.view")),
):
    q = Query_(frm, to, scope, f, True, _today_utc_plus())
    return await _records(await _platform_sources(request, pdb, q.filters), q, limit, offset, sort)


@platform_router.get("/records.csv")
async def platform_csv(
    request: Request,
    frm: str | None = Query(None, alias="from"),
    to: str | None = None,
    scope: str = "sales",
    f: list[str] | None = Query(None),
    pdb: PlatformDB = Depends(get_platform_db),
    p: Principal = Depends(require_permission("platform.tenants.view")),
):
    q = Query_(frm, to, scope, f, True, _today_utc_plus())
    await platform_audit(pdb, p.email, "analytics.export", "platform", {"from": q.frm, "to": q.to, "filters": [f"{d}:{v}" for d, v in q.filters]})
    return await _csv(await _platform_sources(request, pdb, q.filters), q)


@platform_router.get("/bill/{tid}/{bill_id}")
async def platform_bill(
    tid: str, bill_id: str, request: Request, pdb: PlatformDB = Depends(get_platform_db), _: Principal = Depends(require_permission("platform.tenants.view"))
):
    """One bill in full, for the drawer that opens when a row is clicked."""
    t = await pdb.tenants.find_one({"_id": tid})
    if not t:
        raise not_found("Restaurant not found")
    b = await _load(tenant_db_for(request, tid), bill_id)
    return {**online_svc.staff_view(b), "restaurant": t["config"]["brand"]["name"], "restaurant_id": tid}


# ------------------------------------------------------------------ shared
async def _breakdown(sources: list[an.Source], by: str, q: Query_, compare: bool) -> dict:
    if by not in an.DIMENSIONS or (by == "restaurant" and not q.multi):
        raise bad_request("BAD_DIMENSION", "Unknown way to split the figures")
    facts, truncated = await an.collect(sources, q.frm, q.to, q.scope, q.filters, q.multi)
    rows = an.finish(an.breakdown(facts, by, q.filters), by, q.frm, q.to)
    out = {
        "by": by,
        "label": an.DIMENSIONS[by][0],
        "from": q.frm,
        "to": q.to,
        "scope": q.scope,
        "filters": [{"dim": d, "value": v} for d, v in q.filters],
        "totals": an.totals(facts),
        "rows": rows,
        "truncated": truncated,
    }
    if compare:
        pf, pt = an.previous_range(q.frm, q.to)
        prev, _ = await an.collect(sources, pf, pt, q.scope, q.filters, q.multi)
        out["previous"] = {"from": pf, "to": pt, **an.totals(prev)}
    return out


async def _records(sources: list[an.Source], q: Query_, limit: int, offset: int, sort: str) -> dict:
    if sort not in ("created_at", "total", "net"):
        raise bad_request("BAD_SORT", "Sort by created_at, total or net")
    facts, truncated = await an.collect(sources, q.frm, q.to, q.scope, q.filters, q.multi)
    rows = [an.record(f, q.multi) for f in facts]
    rows.sort(key=lambda r: r[sort], reverse=True)
    return {"from": q.frm, "to": q.to, "total_count": len(rows), "summary": an.totals(facts), "truncated": truncated, "rows": rows[offset : offset + limit]}


def _safe(v) -> str:
    s = str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s  # a spreadsheet must never run a customer's name as a formula


async def _csv(sources: list[an.Source], q: Query_) -> Response:
    facts, truncated = await an.collect(sources, q.frm, q.to, q.scope, q.filters, q.multi)
    if len(facts) > CSV_CAP:
        raise ApiError(413, "TOO_MANY_ROWS", f"That is more than {CSV_CAP} bills. Narrow the dates or add a filter.")
    cols = [
        "order_no",
        "created_at",
        "business_date",
        *(["restaurant"] if q.multi else []),
        "type",
        "channel",
        "state",
        "customer",
        "phone",
        "table",
        "rider",
        "coupon",
        "modes",
        "items",
        "total_rupees",
        "net_rupees",
        "discount_rupees",
    ]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    for f in facts:
        r = an.record(f, q.multi)
        r["modes"], r["items"] = " + ".join(r["modes"]), "; ".join(r["items"])
        r["total_rupees"], r["net_rupees"], r["discount_rupees"] = r["total"] / 100, r["net"] / 100, r["discount"] / 100
        w.writerow([_safe(r.get(c, "")) for c in cols])
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="bills-{q.frm}-to-{q.to}.csv"', "X-Truncated": str(truncated).lower()},
    )
