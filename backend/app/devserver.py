"""Lite single-process dev server: API + SMTP receiver, no Docker/Postgres/Redis/MinIO required.

Uses SQLite, a local folder for objects and in-process delivery processing. Intended for trying the
app on one machine — use docker-compose for anything closer to production.

    python -m app.devserver            (see scripts/run-lite.ps1 / scripts/run-lite.sh)
"""
from __future__ import annotations

import os


def main() -> None:  # pragma: no cover
    os.environ.setdefault("DATABASE_URL", "sqlite:///./data/lite.db")
    os.environ.setdefault("STORAGE_BACKEND", "local")
    os.environ.setdefault("STORAGE_LOCAL_PATH", "./data/objects")
    os.environ.setdefault("REDIS_URL", "")
    os.environ.setdefault("PROCESS_INLINE", "true")
    os.environ.setdefault("RECEIVING_DOMAINS", '["mailbox.localhost"]')
    os.environ.setdefault("SMTP_HOST", "127.0.0.1")
    os.makedirs("data", exist_ok=True)

    from alembic import command
    from alembic.config import Config

    command.upgrade(Config("alembic.ini"), "head")

    import uvicorn

    from .inbound.smtp_server import build_controller

    smtp = build_controller()
    smtp.start()
    port = int(os.environ.get("PORT", "8000"))
    print(f"\n  M-Ai-L Box (lite) — UI/API http://127.0.0.1:{port}   SMTP 127.0.0.1:{smtp.port}\n")
    try:
        uvicorn.run("app.main:app", host=os.environ.get("HOST", "127.0.0.1"), port=port, log_level="info")
    finally:
        smtp.stop()


if __name__ == "__main__":  # pragma: no cover
    main()
