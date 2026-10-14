"""Operator commands.

  python -m app.cli create-admin you@example.com      (prompts for a password, or reads ADMIN_PASSWORD)
  python -m app.cli promote you@example.com           (make an existing account an administrator)
  python -m app.cli cleanup                           (run retention cleanup now)
  python -m app.cli init-db                           (create tables without Alembic — tests / lite dev only)
"""
from __future__ import annotations

import getpass
import os
import sys

from sqlalchemy import select


def main(argv: list[str]) -> int:
    from .db import Base, SessionLocal, get_engine
    from .models import User
    from .security import hash_password

    if not argv:
        print(__doc__)
        return 1
    cmd, args = argv[0], argv[1:]
    if cmd == "init-db":
        from . import models  # noqa: F401

        Base.metadata.create_all(get_engine())
        print("tables created")
        return 0
    if cmd == "cleanup":
        from .maintenance import run_cleanup

        print(run_cleanup())
        return 0
    if cmd in ("create-admin", "promote") and args:
        email = args[0].strip().lower()
        db = SessionLocal()
        try:
            user = db.scalar(select(User).where(User.email == email))
            if cmd == "promote":
                if user is None:
                    print("no such user")
                    return 1
                user.is_admin = True
            else:
                password = os.environ.get("ADMIN_PASSWORD") or getpass.getpass("Password (min 10 chars): ")
                if len(password) < 10:
                    print("password too short")
                    return 1
                if user is None:
                    user = User(email=email, password_hash=hash_password(password), is_admin=True)
                    db.add(user)
                else:
                    user.password_hash = hash_password(password)
                    user.is_admin = True
            db.commit()
            print(f"{email} is an administrator")
            return 0
        finally:
            db.close()
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
