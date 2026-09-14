"""
core/auto_migrate.py
-----------------------
Real Alembic migrations (alembic/versions/) are now the primary schema
management mechanism - see apply_schema_migrations() below, called from
main.py's startup hook. This module's OLDER functions
(run_auto_migrations, _migrate_area_uniqueness, _migrate_area_value_domains)
are kept only as the one-time legacy-database bridge apply_schema_migrations()
falls back to for a pre-Alembic database that already has tables from an
earlier deployment; they are no longer run on every startup for a normal,
already-migrated database.
"""
import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

log = logging.getLogger("auto_migrate")


def _default_sql_literal(column) -> str:
    """Best-effort SQL literal for a column's Python-side default, so
    existing rows get a sensible value instead of NULL when a NOT-NULL-ish
    column is added later."""
    default = column.default.arg if column.default is not None else None
    if isinstance(default, bool):
        return "TRUE" if default else "FALSE"
    if isinstance(default, (int, float)):
        return str(default)
    if isinstance(default, str):
        escaped = default.replace("'", "''")
        return f"'{escaped}'"
    return "NULL"


def _migrate_area_uniqueness(conn, inspector) -> None:
    """
    One-time structural fix for the "duplicate key value violates unique
    constraint ix_areas_code" bug: the old schema made Area Code alone
    globally unique, which incorrectly rejected the same code existing
    under a different Division (e.g. "JA" / Pharma and "JA" / Consumer).

    This is a constraint change (not a new column), so the generic
    add-only loop above can't handle it - hence this dedicated,
    idempotent step. It only drops the old unique index/constraint and
    adds the new composite one; no rows are touched or deleted.
    """
    if "areas" not in inspector.get_table_names():
        return  # brand-new install - the model's __table_args__ already creates it correctly

    existing_constraint_names = {c["name"] for c in inspector.get_unique_constraints("areas")}
    existing_index_names = {i["name"] for i in inspector.get_indexes("areas")}

    # Drop the old single-column unique constraint, whichever form Postgres
    # actually stored it as (a UNIQUE constraint or a unique index - both
    # are possible depending on how the table was originally created).
    if "ix_areas_code" in existing_constraint_names:
        conn.execute(text('ALTER TABLE "areas" DROP CONSTRAINT IF EXISTS "ix_areas_code"'))
        log.info("auto_migrate: dropped old unique constraint ix_areas_code")
    if "ix_areas_code" in existing_index_names:
        conn.execute(text('DROP INDEX IF EXISTS "ix_areas_code"'))
        log.info("auto_migrate: dropped old unique index ix_areas_code")

    # Re-create it as a plain (non-unique) index for lookup speed, since the
    # model still declares index=True on the column, just not unique=True.
    conn.execute(text('CREATE INDEX IF NOT EXISTS "ix_areas_code" ON "areas" ("code")'))

    # Add the new composite uniqueness rule if it isn't already there.
    if "uq_areas_code_name_division" not in existing_constraint_names:
        try:
            conn.execute(text(
                'ALTER TABLE "areas" ADD CONSTRAINT "uq_areas_code_name_division" '
                'UNIQUE ("code", "name", "sector")'
            ))
            log.info("auto_migrate: added composite unique constraint uq_areas_code_name_division")
        except Exception as exc:
            # Most likely cause: existing duplicate (code, name, sector) rows
            # already in the table from before this fix. Don't crash startup -
            # log loudly so it's investigated, since data integrity here matters.
            log.warning(
                "auto_migrate: could not add uq_areas_code_name_division (likely "
                "pre-existing duplicate code+name+division rows need manual cleanup "
                "before this constraint can be enforced): %s", exc
            )


def _migrate_area_value_domains(conn, inspector) -> None:
    """
    Areas + Vehicle DB redesign: needs_driver/needs_helper move from
    "Yes"/"No" to "Mandatory"/"Optional"; route_type moves from a binary
    "Main"/"Replacement" to a 4-value domain (see reference_data.py).

    Two things have to happen for an existing database, in order:
      1. Widen the columns - the old VARCHAR(8)/VARCHAR(16) can't hold
         "Mandatory" (9 chars) or "Urgent & Government" (20 chars).
      2. Convert existing values using the same alias map the app uses
         at runtime (reference_data.py), so old and new rows agree.
    Both steps are safe to run repeatedly (idempotent) and touch no rows
    that don't already have an old-style value.
    """
    if "areas" not in inspector.get_table_names():
        return  # brand-new install - model defaults already correct

    conn.execute(text('ALTER TABLE "areas" ALTER COLUMN "needs_driver" TYPE VARCHAR(16)'))
    conn.execute(text('ALTER TABLE "areas" ALTER COLUMN "needs_helper" TYPE VARCHAR(16)'))
    conn.execute(text('ALTER TABLE "areas" ALTER COLUMN "route_type" TYPE VARCHAR(32)'))

    conn.execute(text("UPDATE \"areas\" SET needs_driver = 'Mandatory' WHERE needs_driver = 'Yes'"))
    conn.execute(text("UPDATE \"areas\" SET needs_driver = 'Optional' WHERE needs_driver = 'No'"))
    conn.execute(text("UPDATE \"areas\" SET needs_helper = 'Mandatory' WHERE needs_helper = 'Yes'"))
    conn.execute(text("UPDATE \"areas\" SET needs_helper = 'Optional' WHERE needs_helper = 'No'"))
    conn.execute(text("UPDATE \"areas\" SET route_type = 'Main Route' WHERE route_type = 'Main'"))
    # Best-faith mapping for the old "Replacement" value - flagged in the
    # migration map since the old binary split doesn't map cleanly onto
    # the new 4-value domain; please review/reclassify these areas.
    conn.execute(text("UPDATE \"areas\" SET route_type = 'Second Trip' WHERE route_type = 'Replacement'"))
    log.info("auto_migrate: converted Area needs_driver/needs_helper/route_type to new value domains")


def apply_schema_migrations(engine: Engine, base):
    """
    Schema management entrypoint (V2 verification pass) - REPLACES the old
    startup sequence of create_all() + run_auto_migrations() as the
    primary mechanism. Real Alembic migrations (alembic/versions/) are now
    the source of truth for schema.

    Three cases:
      1. Fresh database (no tables at all): `alembic upgrade head` creates
         every table from the real migration scripts. No create_all()
         involved at all.
      2. Already Alembic-managed (alembic_version table present): normal
         `alembic upgrade head` - applies whatever new migrations exist
         since last deploy. This is the path every deploy takes from now on.
      3. Legacy database (tables already exist from before Alembic was
         adopted here): running migrations from scratch would try to
         CREATE TABLE on tables that already exist and fail. This ONE-TIME
         bridge runs the old create_all() (idempotent - only creates
         tables this legacy database is actually missing) and the old
         structural fixes below, then `alembic stamp head` marks the
         database as caught up. Every subsequent startup takes path 2.
    """
    import os
    from alembic.config import Config
    from alembic import command

    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    cfg = Config(os.path.join(backend_dir, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(backend_dir, "alembic"))
    cfg.set_main_option("sqlalchemy.url", str(engine.url).replace("%", "%%"))

    # Use one explicitly-scoped, explicitly-closed connection for this
    # preflight check, rather than `inspect(engine)` (which checks
    # connections in/out of the app's shared pool per call). Closing it
    # ourselves - instead of trusting it back to the pool - means it can't
    # be left sitting open holding so much as a read lock while the
    # Alembic migration below tries to run.
    print("[auto_migrate] inspecting existing schema...", flush=True)
    with engine.connect() as conn:
        inspector = inspect(conn)
        existing_tables = set(inspector.get_table_names())
        needs_legacy_bridge = existing_tables and "alembic_version" not in existing_tables
    print(f"[auto_migrate] inspected. {len(existing_tables)} table(s), needs_legacy_bridge={needs_legacy_bridge}", flush=True)

    # ROOT-CAUSE FIX for the startup hang: `command.upgrade()` below opens
    # its OWN separate connection (see alembic/env.py). Disposing this
    # engine's pool first guarantees this process isn't ALSO still holding
    # any connection of its own - e.g. a leftover one from a previous
    # failed startup attempt reusing this same engine object - that could
    # block the migration's lock acquisition and hang it indefinitely with
    # no error (see the matching comment in alembic/env.py, which also
    # adds a lock_timeout so any *external* blocking session fails fast
    # with a clear error instead of hanging forever).
    engine.dispose()
    print("[auto_migrate] engine disposed. calling alembic command.upgrade(head)...", flush=True)

    if not needs_legacy_bridge:
        command.upgrade(cfg, "head")
        print("[auto_migrate] command.upgrade(head) returned.", flush=True)
        log.info("apply_schema_migrations: applied Alembic migrations (up to date)")
        return

    log.warning(
        "apply_schema_migrations: legacy pre-Alembic database detected "
        "(tables exist but no alembic_version table) - running one-time bridge"
    )
    base.metadata.create_all(bind=engine)  # idempotent: only creates tables this legacy DB is missing
    try:
        run_auto_migrations(engine, base)  # idempotent: historical column/constraint fixes this legacy DB may still need
    except Exception:
        log.exception(
            "apply_schema_migrations: legacy structural fixes (run_auto_migrations) failed - "
            "continuing anyway so the app can still start; check logs and re-run manually if needed"
        )
    command.stamp(cfg, "head")
    log.warning("apply_schema_migrations: legacy bridge complete - database is now Alembic-managed")


def run_auto_migrations(engine: Engine, base):
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table in base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue  # brand-new table - create_all() already handled it
            existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_cols:
                    continue
                col_type = column.type.compile(dialect=engine.dialect)
                default_sql = _default_sql_literal(column)
                stmt = (
                    f'ALTER TABLE "{table.name}" ADD COLUMN IF NOT EXISTS '
                    f'"{column.name}" {col_type} DEFAULT {default_sql}'
                )
                try:
                    conn.execute(text(stmt))
                    log.info("auto_migrate: added %s.%s", table.name, column.name)
                except Exception as exc:  # never block startup over a migration hiccup
                    log.warning("auto_migrate: could not add %s.%s: %s", table.name, column.name, exc)

        # Structural (non-add-column) fixes go here, one function per fix.
        _migrate_area_uniqueness(conn, inspector)
        _migrate_area_value_domains(conn, inspector)
