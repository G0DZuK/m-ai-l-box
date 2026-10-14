from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from ..config import get_settings
from ..db import SessionLocal
from ..ratelimit import get_redis
from ..storage import get_storage

router = APIRouter(prefix="/api", tags=["service"])


def component_health() -> dict[str, str]:
    checks: dict[str, str] = {}
    try:
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
        finally:
            db.close()
        checks["database"] = "ok"
    except Exception:
        checks["database"] = "error"
    try:
        get_storage().check()
        checks["storage"] = "ok"
    except Exception:
        checks["storage"] = "error"
    r = get_redis()
    if r is None:
        checks["redis"] = "not_configured"
    else:
        try:
            r.ping()
            checks["redis"] = "ok"
        except Exception:
            checks["redis"] = "unavailable"
    return checks


@router.get("/health", summary="Service health")
def health():
    checks = component_health()
    ok = checks["database"] == "ok" and checks["storage"] == "ok"
    return {"status": "ok" if ok and checks["redis"] != "unavailable" else "degraded", "checks": checks}


@router.get("/config", summary="Public service settings")
def public_config():
    s = get_settings()
    return {
        "app_name": s.app_name,
        "tagline": s.tagline,
        "domains": s.receiving_domains,
        "default_domain": s.default_domain,
        "demo_mode": s.demo_mode,
        "inbound_adapters": s.inbound_adapters,
        "accounts_enabled": s.accounts_enabled,
        "registration_open": s.accounts_enabled and s.registration_open,
        "custom_local_part_allowed": s.custom_local_part_allowed,
        "temp_mailbox_ttl_hours": s.temp_mailbox_ttl_hours,
        "trash_retention_days": s.trash_retention_days,
        "saved_message_retention_days": s.saved_message_retention_days,
        "temp_mailbox_max_messages": s.temp_mailbox_max_messages,
        "max_message_bytes": s.max_message_bytes,
        "max_upload_bytes": s.max_upload_bytes,
        "user_quota_bytes": s.user_quota_bytes,
        "scanner": s.scanner,
        "wait_max_seconds": s.wait_max_seconds,
    }
