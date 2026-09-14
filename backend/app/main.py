from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import os
import traceback

from app.core.config import settings
from app.core.database import Base, engine
from app.api.routes import (
    auth, fleet, route_plan, dashboard, jobs, imports,
    customer_intelligence, correlation, setup, route_intelligence, ai, backup, experience, appearance,
    feature_flags, audit as audit_routes, salesman, control_center,
)

# Import all models so Base.metadata is fully populated - needed by
# alembic/env.py's autogenerate AND by the one-time legacy-database bridge
# in core/auto_migrate.py (see apply_schema_migrations() there). Keep this
# list in sync with alembic/env.py's import list.
from app.models import (  # noqa: F401
    user, fleet as fleet_models, route_plan as route_plan_models,
    job as job_models, imports as import_models, customer as customer_models,
    analytics_facts as analytics_fact_models, ai_config as ai_config_models,
    appearance as appearance_models, feature_flags as feature_flag_models,
    audit_log as audit_log_models, master_data as master_data_models,
    dashboard_config as dashboard_config_models,
    sheet_layout as sheet_layout_models,
    area_groups as area_group_models,
    salesman as salesman_models,
    control_center as control_center_models,
)

app = FastAPI(title=settings.APP_NAME)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """
    Without this, an unhandled crash (e.g. the passlib/bcrypt version
    mismatch that broke first-run setup) returns Starlette's default
    plain-text "Internal Server Error" body. The frontend always expects
    JSON and throws a confusing "unexpected token... is not valid JSON"
    error instead of showing the real problem. This guarantees every
    error - expected or not - comes back as JSON the frontend can display.
    """
    print(f"UNHANDLED ERROR on {request.method} {request.url.path}:")
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": f"Server error: {exc}"},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    """
    Schema management (V2 verification pass): Alembic migrations
    (alembic/versions/) are now the source of truth for schema, not
    Base.metadata.create_all(). See alembic/env.py and the two migrations
    there for the full history.

    apply_schema_migrations() below:
      - Fresh database (no tables at all): runs `alembic upgrade head`,
        which creates every table via the real migration scripts.
      - Legacy database (tables already exist from before Alembic was
        adopted, e.g. an earlier deployment that only ever ran
        create_all()): `alembic upgrade head` would fail trying to
        CREATE TABLE on tables that already exist. In that one case only,
        this falls back to a ONE-TIME bridge: create_all() (idempotent -
        it never touches a table that already exists, so it only creates
        whatever tables this legacy database is missing, e.g. a table
        added by a more recent migration) followed by `alembic stamp
        head` to mark the database as caught up. From that point on,
        every subsequent deploy goes through real migrations again - this
        bridge only ever runs once per database.
    """
    from app.core.auto_migrate import apply_schema_migrations
    print("[main.py] on_startup: calling apply_schema_migrations()...", flush=True)
    apply_schema_migrations(engine, Base)
    print("[main.py] on_startup: apply_schema_migrations() returned.", flush=True)
    os.makedirs(settings.IMPORT_FOLDER, exist_ok=True)
    os.makedirs(settings.EXPORT_FOLDER, exist_ok=True)
    os.makedirs(settings.BACKUP_FOLDER, exist_ok=True)


app.include_router(auth.router)
app.include_router(fleet.router)
app.include_router(route_plan.router)
app.include_router(dashboard.router)
app.include_router(jobs.router)
app.include_router(imports.router)
app.include_router(customer_intelligence.router)
app.include_router(correlation.router)
app.include_router(setup.router)
app.include_router(route_intelligence.router)
app.include_router(ai.router)
app.include_router(backup.router)
app.include_router(experience.router)
app.include_router(appearance.router)
app.include_router(feature_flags.router)
app.include_router(audit_routes.router)
app.include_router(salesman.router)
app.include_router(control_center.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME, "env": settings.ENV}


# One-folder deployment: serve the built React app from the same FastAPI
# process, so "one company PC/server, browser access, no installation for
# viewers" works without a separate web server.
_frontend_dist = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.isdir(_frontend_dist):
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")
