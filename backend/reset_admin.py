"""
reset_admin.py
-----------------
RECOVERY TOOL ONLY - not part of normal installation or normal use.

If you're locked out (forgot the Admin password you set during first-run
setup, or mistyped it and didn't realize), run this from the server:

    cd backend
    .venv\\Scripts\\activate      (Windows)   or   source .venv/bin/activate   (Linux/Mac)
    python reset_admin.py

It deletes ALL existing user accounts, which makes the "users table is
empty" condition true again - so the next time anyone opens the app in a
browser, the "Create Administrator Account" setup page reappears
automatically, exactly like a brand-new install.

WHY THIS ISN'T A BROWSER BUTTON: a "reset the admin account" button
reachable from the login page would let anyone on the network hijack the
system by resetting it themselves. Requiring someone to actually be at
the server (or have remote access to run a script on it) is the point,
not an oversight - this is the same reason most real software puts
account-recovery tools behind server/admin access rather than a public
"forgot password" link when there's no verified email/phone to send a
reset code to.
"""
from app.core.database import SessionLocal
from app.models.user import User

db = SessionLocal()
try:
    count = db.query(User).count()
    if count == 0:
        print("No user accounts exist - the setup page should already be showing in the browser.")
    else:
        print(f"This will permanently delete all {count} existing user account(s), including all Admin, "
              "Dispatcher, and Viewer logins. The next browser visit will show the first-run setup page again.")
        confirm = input("Type YES to continue: ").strip()
        if confirm == "YES":
            db.query(User).delete()
            db.commit()
            print("All user accounts deleted. Open the app in a browser to create a new Administrator account.")
        else:
            print("Cancelled - nothing was changed.")
finally:
    db.close()
