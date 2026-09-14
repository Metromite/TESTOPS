"""
first_run_config.py
----------------------
Runs automatically from start_server.bat/.sh before the server starts.
If backend/.env already exists, does nothing and exits immediately - this
only runs once, on a truly fresh install.

Asks a few plain-English questions (not SQL, not a database console) about
the PostgreSQL server you just installed, then writes .env with a
generated random SECRET_KEY. This is the only place PostgreSQL connection
details are entered - there is no separate psql/pgAdmin step required
for a normal installation.
"""
import os
import secrets

_HERE = os.path.dirname(os.path.abspath(__file__))
_ENV_PATH = os.path.join(_HERE, ".env")


def main():
    if os.path.exists(_ENV_PATH):
        return  # already configured - nothing to do

    print("=" * 60)
    print(" Dispatch OPS - First-Time Server Setup")
    print("=" * 60)
    print("This only runs once. Answer these about the PostgreSQL")
    print("server you just installed (press Enter to accept the")
    print("default shown in brackets).\n")

    host = input("PostgreSQL host [localhost]: ").strip() or "localhost"
    port = input("PostgreSQL port [5432]: ").strip() or "5432"
    superuser = input("PostgreSQL superuser name [postgres]: ").strip() or "postgres"
    superuser_password = input("PostgreSQL superuser password (set during install): ").strip()
    db_name = input("Database name to use/create [dispatch_controller]: ").strip() or "dispatch_controller"

    database_url = f"postgresql+psycopg2://{superuser}:{superuser_password}@{host}:{port}/{db_name}"
    secret_key = secrets.token_urlsafe(48)

    with open(_ENV_PATH, "w", encoding="utf-8") as f:
        f.write(f"""APP_NAME=Dispatch OPS
ENV=production

DATABASE_URL={database_url}

SECRET_KEY={secret_key}
ACCESS_TOKEN_EXPIRE_MINUTES=720

IMPORT_FOLDER=./data/imports
EXPORT_FOLDER=./data/exports
BACKUP_FOLDER=./data/backups
""")

    print("\nSaved backend/.env. Continuing startup...\n")


if __name__ == "__main__":
    main()
