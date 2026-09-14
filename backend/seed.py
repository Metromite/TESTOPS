"""
seed.py
--------
OPTIONAL emergency fallback only. Normal installs do NOT need this file -
the first person to open the app in a browser creates the Admin account
through the "Create Administrator Account" setup page automatically
(see api/routes/setup.py and frontend/src/pages/Setup.tsx).

Use this script only if you're locked out (e.g. the only admin account
was deleted and the users table isn't empty, so the browser setup page
won't reappear):

    python seed.py
"""
import getpass

from app.core.database import Base, engine, SessionLocal
from app.core.security import hash_password
from app.models.user import User, Role
from app.models import fleet, route_plan  # noqa: F401 - register tables

Base.metadata.create_all(bind=engine)

db = SessionLocal()
try:
    if db.query(User).filter(User.role == Role.ADMIN).first():
        print("An admin user already exists - nothing to do. If you're locked out, "
              "reset that user's password directly in the database instead of creating a duplicate.")
    else:
        username = input("Admin username: ").strip()
        password = getpass.getpass("Admin password: ")
        user = User(username=username, hashed_password=hash_password(password), role=Role.ADMIN)
        db.add(user)
        db.commit()
        print(f"Admin user '{username}' created.")
finally:
    db.close()

