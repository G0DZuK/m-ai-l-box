"""Business logic shared by the API, the SMTP receiver and background jobs."""
from __future__ import annotations

import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .config import get_settings
from .db import utcnow
from .models import Attachment, Delivery, Mailbox, Message, StoredFile, User
from .security import MAILBOX_PREFIX, hash_token, new_token, token_hint
from .storage import StorageError, get_storage

log = logging.getLogger(__name__)

RESERVED_LOCAL_PARTS = {
    "postmaster", "abuse", "admin", "administrator", "root", "hostmaster", "webmaster", "security",
    "noreply", "no-reply", "mailer-daemon", "support", "info", "billing", "ssl-admin", "www",
}
LOCAL_PART_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,39}$")
_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # no look-alikes (0/o, 1/l/i)


class ServiceError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def random_local_part(length: int = 10) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def validate_local_part(local: str) -> str:
    local = local.strip().lower()
    if not LOCAL_PART_RE.match(local) or ".." in local or local.endswith((".", "-", "_")):
        raise ServiceError(
            422, "Use 3–40 letters, digits, dots, dashes or underscores, starting with a letter or digit."
        )
    if local in RESERVED_LOCAL_PARTS or "+" in local:
        raise ServiceError(422, "That name is reserved. Please choose another.")
    return local


def create_mailbox(
    db: Session,
    *,
    domain: str | None = None,
    local_part: str | None = None,
    label: str | None = None,
    owner: User | None = None,
    is_demo: bool = False,
    ip_hash: str | None = None,
) -> tuple[Mailbox, str]:
    s = get_settings()
    domain = (domain or s.default_domain).strip().lower()
    if domain not in s.receiving_domains:
        raise ServiceError(422, "That domain is not configured for receiving mail.")
    if local_part:
        if not s.custom_local_part_allowed:
            raise ServiceError(422, "Custom addresses are disabled on this server.")
        local_part = validate_local_part(local_part)
        if db.scalar(select(Mailbox.id).where(Mailbox.address == f"{local_part}@{domain}")):
            raise ServiceError(409, "That address is already taken. Try another name.")
    else:
        for _ in range(10):
            local_part = random_local_part()
            if not db.scalar(select(Mailbox.id).where(Mailbox.address == f"{local_part}@{domain}")):
                break
        else:  # pragma: no cover - astronomically unlikely
            raise ServiceError(503, "Could not allocate an address, please retry.")

    token = new_token(MAILBOX_PREFIX)
    now = utcnow()
    mb = Mailbox(
        address=f"{local_part}@{domain}",
        local_part=local_part,
        domain=domain,
        label=(label or "").strip()[:120] or None,
        token_hash=hash_token(token),
        token_hint=token_hint(token),
        owner_user_id=owner.id if owner else None,
        created_at=now,
        expires_at=None if owner else now + timedelta(hours=s.temp_mailbox_ttl_hours),
        is_demo=is_demo,
        created_ip_hash=ip_hash,
    )
    db.add(mb)
    db.commit()
    return mb, token


def rotate_mailbox_token(db: Session, mb: Mailbox) -> str:
    token = new_token(MAILBOX_PREFIX)
    mb.token_hash = hash_token(token)
    mb.token_hint = token_hint(token)
    db.commit()
    return token


def mailbox_is_active(mb: Mailbox, now: datetime | None = None) -> bool:
    now = now or utcnow()
    return not mb.disabled and (mb.expires_at is None or mb.expires_at > now)


# ---------------------------------------------------------------- usage / quotas

def mailbox_usage(db: Session, mailbox_id: uuid.UUID) -> tuple[int, int]:
    """(message_count, bytes) including trash."""
    count, size = db.execute(
        select(func.count(Message.id), func.coalesce(func.sum(Message.size_bytes), 0)).where(
            Message.mailbox_id == mailbox_id
        )
    ).one()
    return int(count), int(size)


def user_quota(user: User) -> int:
    return user.quota_bytes if user.quota_bytes is not None else get_settings().user_quota_bytes


def user_usage(db: Session, user_id: uuid.UUID) -> dict:
    messages_bytes = db.scalar(
        select(func.coalesce(func.sum(Message.size_bytes), 0))
        .join(Mailbox, Mailbox.id == Message.mailbox_id)
        .where(Mailbox.owner_user_id == user_id)
    )
    files_bytes = db.scalar(
        select(func.coalesce(func.sum(StoredFile.size_bytes), 0)).where(StoredFile.user_id == user_id)
    )
    return {"messages_bytes": int(messages_bytes or 0), "files_bytes": int(files_bytes or 0),
            "used_bytes": int(messages_bytes or 0) + int(files_bytes or 0)}


def mailbox_has_room(db: Session, mb: Mailbox, incoming_bytes: int) -> bool:
    s = get_settings()
    if mb.owner_user_id:
        owner = db.get(User, mb.owner_user_id)
        if owner is None:
            return False
        return user_usage(db, owner.id)["used_bytes"] + incoming_bytes <= user_quota(owner)
    count, size = mailbox_usage(db, mb.id)
    return count < s.temp_mailbox_max_messages and size + incoming_bytes <= s.temp_mailbox_quota_bytes


# ---------------------------------------------------------------- deletion

def _safe_delete(key: str | None) -> None:
    if not key:
        return
    try:
        get_storage().delete(key)
    except (StorageError, Exception):  # storage hiccups must not block DB deletion
        log.warning("could not delete object (will be orphaned)")


def delete_message(db: Session, msg: Message, commit: bool = True) -> None:
    """Permanently delete a message, its attachments and — if no other message shares it — the original."""
    keys = [a.storage_key for a in db.scalars(select(Attachment).where(Attachment.message_id == msg.id))]
    raw_key = msg.raw_key
    db.delete(msg)
    db.flush()
    if raw_key and not db.scalar(select(func.count(Message.id)).where(Message.raw_key == raw_key)):
        db.execute(update(Delivery).where(Delivery.raw_key == raw_key).values(raw_key=None))
        keys.append(raw_key)
    if commit:
        db.commit()
    for k in keys:
        _safe_delete(k)


def delete_mailbox(db: Session, mb: Mailbox) -> int:
    msgs = list(db.scalars(select(Message).where(Message.mailbox_id == mb.id)))
    for m in msgs:
        delete_message(db, m, commit=False)
    db.delete(mb)
    db.commit()
    return len(msgs)


def delete_user(db: Session, user: User) -> None:
    for mb in list(db.scalars(select(Mailbox).where(Mailbox.owner_user_id == user.id))):
        delete_mailbox(db, mb)
    keys = [f.storage_key for f in db.scalars(select(StoredFile).where(StoredFile.user_id == user.id))]
    db.delete(user)
    db.commit()
    for k in keys:
        _safe_delete(k)
