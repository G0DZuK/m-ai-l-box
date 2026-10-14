"""Scheduled retention cleanup (Celery beat runs it hourly; admins can trigger it)."""
from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import delete, func, select

from .config import get_settings
from .db import SessionLocal, utcnow
from .models import AbuseBlock, Delivery, Mailbox, Message, UserSession
from .services import _safe_delete, delete_mailbox, delete_message

log = logging.getLogger(__name__)
BATCH = 500


def run_cleanup() -> dict:
    s = get_settings()
    now = utcnow()
    counts = {"expired_mailboxes": 0, "trash_messages": 0, "retention_messages": 0, "deliveries": 0, "sessions": 0}
    db = SessionLocal()
    try:
        # 1. Temporary mailboxes past their expiry → mailbox, messages, attachments, originals
        for mb in db.scalars(
            select(Mailbox).where(Mailbox.owner_user_id.is_(None), Mailbox.expires_at < now).limit(BATCH)
        ).all():
            delete_mailbox(db, mb)
            counts["expired_mailboxes"] += 1

        # 2. Trash older than TRASH_RETENTION_DAYS
        cutoff = now - timedelta(days=s.trash_retention_days)
        for msg in db.scalars(select(Message).where(Message.deleted_at < cutoff).limit(BATCH)).all():
            delete_message(db, msg)
            counts["trash_messages"] += 1

        # 3. Optional retention for saved mailboxes (0 = keep until the user deletes)
        if s.saved_message_retention_days > 0:
            cutoff = now - timedelta(days=s.saved_message_retention_days)
            q = (
                select(Message)
                .join(Mailbox, Mailbox.id == Message.mailbox_id)
                .where(Mailbox.owner_user_id.is_not(None), Message.received_at < cutoff)
                .limit(BATCH)
            )
            for msg in db.scalars(q).all():
                delete_message(db, msg)
                counts["retention_messages"] += 1

        # 4. Delivery log (metadata) + originals no longer referenced by any message
        cutoff = now - timedelta(days=s.delivery_log_retention_days)
        for d in db.scalars(
            select(Delivery).where(
                Delivery.received_at < cutoff, Delivery.status.in_(("processed", "rejected", "failed"))
            ).limit(BATCH)
        ).all():
            if d.raw_key and not db.scalar(select(func.count(Message.id)).where(Message.raw_key == d.raw_key)):
                _safe_delete(d.raw_key)
            db.delete(d)
            counts["deliveries"] += 1
        db.commit()

        # 5. Expired sessions and abuse blocks
        counts["sessions"] = db.execute(delete(UserSession).where(UserSession.expires_at < now)).rowcount or 0
        db.execute(delete(AbuseBlock).where(AbuseBlock.expires_at.is_not(None), AbuseBlock.expires_at < now))
        db.commit()
    finally:
        db.close()
    log.info("cleanup finished: %s", counts)
    return counts
