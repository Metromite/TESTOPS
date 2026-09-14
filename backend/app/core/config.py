"""
core/config.py
---------------
Environment-driven settings, one object every part of the app reads from.
Ported pattern from V1's environment_config.py: no module should hardcode
"are we in dev mode" logic - everything reads Settings.<field> instead.

Set values via a `.env` file next to start_server, or real environment
variables (recommended for DATABASE_URL / SECRET_KEY in production).
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    APP_NAME: str = "Dispatch OPS"
    ENV: str = "development"  # development | production | viewer

    # One shared company Postgres database - single source of truth.
    DATABASE_URL: str = (
        "postgresql+psycopg2://dispatch:dispatch@localhost:5432/dispatch_controller"
    )

    # TEMPORARY: auth is disabled app-wide while the rest of the app is
    # being finished, per explicit request. Every protected endpoint treats
    # every request as a synthetic Admin user when this is True. Flip this
    # to False (and re-enable the frontend's login gate in SetupGate.tsx /
    # ProtectedLayout.tsx) when you're ready to turn auth back on - nothing
    # else needs to change, the login/setup system underneath is untouched.
    AUTH_DISABLED: bool = True

    # Auth
    SECRET_KEY: str = "CHANGE-ME-IN-PRODUCTION-ENV-FILE"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12
    ALGORITHM: str = "HS256"

    # Optional: folder containing pg_dump/pg_restore, if not already on PATH
    # (the PostgreSQL installer usually adds this automatically).
    PG_BIN_DIR: str = ""

    # Where uploaded SAP/Landmark exports and generated Excel exports live
    IMPORT_FOLDER: str = "./data/imports"
    EXPORT_FOLDER: str = "./data/exports"
    BACKUP_FOLDER: str = "./data/backups"

    # CORS - the one-folder LAN deployment serves the frontend from the
    # same origin in production; this only matters for `npm run dev`.
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]


settings = Settings()
