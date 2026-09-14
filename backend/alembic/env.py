import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool
from sqlalchemy import text

from alembic import context

# Make "app.*" importable regardless of the working directory this is run from.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# Import every model module so Base.metadata is fully populated before
# autogenerate compares it against the live database - same import list
# app/main.py uses at startup, kept in sync deliberately (see that file's
# comment). If a new model file is added, add it to BOTH places.
from app.core.database import Base  # noqa: E402
from app.models import (  # noqa: E402,F401
    user, fleet, route_plan, job, imports, customer,
    analytics_facts, ai_config, appearance, feature_flags,
    audit_log, master_data, dashboard_config, sheet_layout,
    area_groups, salesman, control_center,
)

target_metadata = Base.metadata

# Prefer the app's own DATABASE_URL (same settings.py every other part of
# the app uses) over whatever static URL is in alembic.ini, so migrations
# always run against the actual configured database, in every environment,
# without needing alembic.ini edited per-deployment.
from app.core.config import settings  # noqa: E402
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    print("[env.py] building engine...", flush=True)
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    print("[env.py] connecting...", flush=True)
    with connectable.connect() as connection:
        print("[env.py] connected. setting timeouts...", flush=True)
        # ROOT-CAUSE FIX for the startup/CLI hang: the stock Alembic
        # template sets no timeout at all on this connection. If ANY other
        # Postgres session - most commonly a leftover/zombie connection
        # from a previous crashed `alembic upgrade head` or app startup
        # that never committed/rolled back - is holding a lock on a table
        # this migration run needs (even just to acquire the DDL lock
        # while checking alembic_version), Postgres makes this connection
        # wait with NO output and NO error, indefinitely. That is exactly
        # "stops after 'Will assume transactional DDL.' and never
        # returns" - it isn't stuck in Python at all, it's parked inside a
        # blocking network read waiting on Postgres's lock manager.
        # A lock_timeout turns that silent infinite wait into a normal,
        # fast, readable error ("could not obtain lock on ... within
        # 10000ms") so the actually-blocking session can be found (e.g.
        # `SELECT pid, state, query FROM pg_stat_activity WHERE state =
        # 'idle in transaction';`) and terminated, instead of looking
        # indistinguishable from a hang in this script.
        connection.execute(text("SET lock_timeout = '10s'"))
        connection.execute(text("SET statement_timeout = '60s'"))
        # BUGFIX: SQLAlchemy 2.0 "autobegin" means the two SET statements
        # above silently opened a transaction on this connection before
        # Alembic's own context.begin_transaction() below ever runs. When
        # that happens, Alembic detects an already-active transaction and
        # assumes it's externally managed (e.g. the caller wants to control
        # commit/rollback themselves), so it does NOT commit it at the end
        # of the migration run. The result: migrations "succeed" (no error,
        # full log output) but every DDL change is silently discarded when
        # `with connectable.connect() as connection:` closes the connection
        # without an explicit commit - the DB is left with zero tables.
        # Committing here closes out that autobegin transaction so the
        # transaction Alembic itself starts next is the one it owns and
        # commits normally.
        connection.commit()
        print("[env.py] timeouts set. configuring context...", flush=True)

        context.configure(
            connection=connection, target_metadata=target_metadata
        )
        print("[env.py] context configured. beginning transaction...", flush=True)

        with context.begin_transaction():
            print("[env.py] transaction begun. running migrations...", flush=True)
            context.run_migrations()
            print("[env.py] run_migrations() returned.", flush=True)
    print("[env.py] connection closed. run_migrations_online() done.", flush=True)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
