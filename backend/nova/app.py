from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from motor.motor_asyncio import AsyncIOMotorClient
from starlette.middleware.cors import CORSMiddleware

from .api import routes_platform, routes_pos, routes_public, routes_tenant
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
    app.include_router(routes_pos.router)
    app.include_router(routes_platform.router)

    web = Path(__file__).resolve().parents[2] / "web"
    if web.is_dir():
        @app.middleware("http")
        async def web_headers(request, call_next):
            resp = await call_next(request)
            if request.url.path.startswith("/app"):
                resp.headers["Content-Security-Policy"] = (
                    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                    "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' http://127.0.0.1:8989 http://localhost:8989; "
                    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
                )
                resp.headers["X-Content-Type-Options"] = "nosniff"
                resp.headers["Referrer-Policy"] = "same-origin"
            return resp

        app.mount("/app", StaticFiles(directory=web, html=True), name="web")

        @app.get("/", include_in_schema=False)
        async def root():
            return RedirectResponse("/app/")
    return app
