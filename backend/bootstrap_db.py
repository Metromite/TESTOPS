"""
bootstrap_db.py
-----------------
Runs automatically from start_server.bat/.sh, right after
first_run_config.py and before the FastAPI app starts. Connects to
Postgres's built-in `postgres` maintenance database (which always exists)
using the credentials from .env, checks whether the target database
already exists, and creates it if not - so nobody has to open psql/pgAdmin
and type CREATE DATABASE by hand.

Table creation itself still happens in app/main.py's startup hook
(Base.metadata.create_all) - this script only makes sure the DATABASE
exists before SQLAlchemy tries to connect to it.
"""
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError

from app.core.config import settings


def main():
    target_url = make_url(settings.DATABASE_URL)
    target_db = target_url.database
    maintenance_url = target_url.set(database="postgres")

    try:
        engine = create_engine(maintenance_url, isolation_level="AUTOCOMMIT")
        with engine.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": target_db}
            ).fetchone()
            if exists:
                print(f"Database '{target_db}' already exists - nothing to do.")
            else:
                print(f"Database '{target_db}' not found - creating it now...")
                # CREATE DATABASE can't be parameterized - target_db comes only
                # from our own .env file (not user/browser input at request time),
                # so this is safe, not an injection surface.
                conn.execute(text(f'CREATE DATABASE "{target_db}"'))
                print(f"Database '{target_db}' created.")
    except OperationalError as exc:
        print("\nCould not connect to PostgreSQL using the details in backend/.env.")
        print("Double-check that PostgreSQL is installed and running (Services -> "
              "postgresql-x64-XX), and that the host/port/username/password in "
              ".env are correct.\n")
        print(f"Underlying error: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
