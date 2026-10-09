from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from motor.motor_asyncio import AsyncIOMotorClient
from starlette.middleware.cors import CORSMiddleware

from .api import routes_platform, routes_public, routes_tenant
from .core.config import Settings
from .core.startup_checks import assert_safe_startup
from .tenancy.db import ensure_indexes


def create_app(settings: Settings | None = None, database=None) -> FastAPI:
    """``database`` can be injected (tests use an in-memory Mongo)."""
    settings = settings or Settings()
    assert_safe_startup(settings)
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await ensure_indexes(app.state.database)
        yield

    app = FastAPI(title="Nova Restaurant Platform", version="0.1.0", docs_url=None if settings.is_production else "/docs", lifespan=lifespan)
    app.state.settings = settings
    app.state.database = database if database is not None else AsyncIOMotorClient(settings.mongo_url)[settings.db_name]
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    )

    app.include_router(routes_public.router)
    app.include_router(routes_tenant.router)
    app.include_router(routes_platform.router)
    return app
