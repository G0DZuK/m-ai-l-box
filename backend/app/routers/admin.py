"""Administrator API. Never returns message subjects, bodies, attachment names or full recipient addresses."""
from __future__ import annotations

import base64
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db, utcnow
from ..deps import require_admin
from ..models import AbuseBlock, Attachment, Delivery, Mailbox, Message, StoredFile, User
from ..security import hash_ip
from ..services import user_quota, user_usage
from .meta import component_health

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    s = get_settings()
    now = utcnow()
    day = now - timedelta(hours=24)
    by_status = dict(
        db.execute(select(Delivery.status, func.count(Delivery.id)).where(Delivery.received_at >= day).group_by(Delivery.status)).all()
    )
    return {
        "health": component_health(),
        "counts": {
            "users": db.scalar(select(func.count(User.id))),
            "mailboxes_temporary": db.scalar(select(func.count(Mailbox.id)).where(Mailbox.owner_user_id.is_(None))),
            "mailboxes_saved": db.scalar(select(func.count(Mailbox.id)).where(Mailbox.owner_user_id.is_not(None))),
            "mailboxes_disabled": db.scalar(select(func.count(Mailbox.id)).where(Mailbox.disabled.is_(True))),
            "messages": db.scalar(select(func.count(Message.id))),
            "attachments": db.scalar(select(func.count(Attachment.id))),
            "files": db.scalar(select(func.count(StoredFile.id))),
            "infected_attachments": db.scalar(select(func.count(Attachment.id)).where(Attachment.scan_status == "infected")),
            "failed_deliveries_total": db.scalar(select(func.count(Delivery.id)).where(Delivery.status == "failed")),
        },
        "storage": {
            "messages_bytes": int(db.scalar(select(func.coalesce(func.sum(Message.size_bytes), 0))) or 0),
            "files_bytes": int(db.scalar(select(func.coalesce(func.sum(StoredFile.size_bytes), 0))) or 0),
        },
        "deliveries_24h": {k: by_status.get(k, 0) for k in ("queued", "processing", "processed", "failed", "rejected")},
        "limits": {
            "max_message_bytes": s.max_message_bytes, "max_upload_bytes": s.max_upload_bytes,
            "user_quota_bytes": s.user_quota_bytes, "temp_mailbox_max_messages": s.temp_mailbox_max_messages,
            "temp_mailbox_quota_bytes": s.temp_mailbox_quota_bytes,
            "rl_mailbox_create_per_hour": s.rl_mailbox_create_per_hour, "rl_api_per_minute": s.rl_api_per_minute,
            "rl_inbound_per_mailbox_per_hour": s.rl_inbound_per_mailbox_per_hour,
        },
        "retention": {
            "temp_mailbox_ttl_hours": s.temp_mailbox_ttl_hours, "trash_retention_days": s.trash_retention_days,
            "saved_message_retention_days": s.saved_message_retention_days,
            "delivery_log_retention_days": s.delivery_log_retention_days,
        },
        "inbound": {"adapters": s.inbound_adapters, "domains": s.receiving_domains,
                    "unknown_recipient_policy": s.unknown_recipient_policy, "scanner": s.scanner},
    }


@router.get("/deliveries")
def deliveries(
    db: Session = Depends(get_db),
    status: str | None = Query(None, pattern="^(queued|processing|processed|failed|rejected)$"),
    limit: int = Query(50, ge=1, le=200),
    cursor: str | None = None,
):
    q = select(Delivery)
    if status:
        q = q.where(Delivery.status == status)
    offset = int(base64.urlsafe_b64decode(cursor.encode()).decode()) if cursor else 0
    rows = list(db.scalars(q.order_by(Delivery.received_at.desc()).offset(offset).limit(limit + 1)))
    items = [
        {
            "id": d.id, "source": d.source, "status": d.status, "attempts": d.attempts, "last_error": d.last_error,
            "size_bytes": d.size_bytes, "recipient_domains": d.recipient_domains, "recipient_count": d.recipient_count,
            "matched_count": d.matched_count, "received_at": d.received_at, "processed_at": d.processed_at,
        }
        for d in rows[:limit]
    ]
    nxt = base64.urlsafe_b64encode(str(offset + limit).encode()).decode() if len(rows) > limit else None
    return {"items": items, "next_cursor": nxt}


@router.post("/deliveries/{delivery_id}/retry")
def retry_delivery(delivery_id: uuid.UUID, db: Session = Depends(get_db)):
    d = db.get(Delivery, delivery_id)
    if d is None:
        raise HTTPException(404, "Delivery not found")
    if d.status not in ("failed", "queued"):
        raise HTTPException(409, f"Only failed or queued deliveries can be retried (this one is {d.status}).")
    if not d.raw_key:
        raise HTTPException(409, "The original message is no longer stored; it cannot be retried.")
    d.status = "queued"
    d.last_error = None
    db.commit()
    from ..tasks import enqueue_delivery

    enqueue_delivery(d.id)
    db.refresh(d)
    return {"id": d.id, "status": d.status}


@router.get("/users")
def users(db: Session = Depends(get_db), q: str | None = Query(None, max_length=200), limit: int = Query(100, le=500)):
    query = select(User)
    if q:
        query = query.where(func.lower(User.email).contains(q.lower(), autoescape=True))
    out = []
    for u in db.scalars(query.order_by(User.created_at.desc()).limit(limit)):
        out.append({
            "id": u.id, "email": u.email, "is_admin": u.is_admin, "disabled": u.disabled, "created_at": u.created_at,
            "quota_bytes": user_quota(u), "used_bytes": user_usage(db, u.id)["used_bytes"],
            "mailbox_count": db.scalar(select(func.count(Mailbox.id)).where(Mailbox.owner_user_id == u.id)),
        })
    return {"items": out}


class PatchUserIn(BaseModel):
    quota_bytes: int | None = Field(default=None, ge=0)
    disabled: bool | None = None
    is_admin: bool | None = None


@router.patch("/users/{user_id}")
def patch_user(user_id: uuid.UUID, body: PatchUserIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "User not found")
    if u.id == admin.id and (body.disabled or body.is_admin is False):
        raise HTTPException(409, "You cannot disable or demote your own account.")
    if body.quota_bytes is not None:
        u.quota_bytes = body.quota_bytes
    if body.disabled is not None:
        u.disabled = body.disabled
    if body.is_admin is not None:
        u.is_admin = body.is_admin
    db.commit()
    return {"id": u.id, "email": u.email, "is_admin": u.is_admin, "disabled": u.disabled, "quota_bytes": user_quota(u)}


class BlockIn(BaseModel):
    kind: str = Field(pattern="^(sender|sender_domain|ip|mailbox)$")
    value: str = Field(min_length=1, max_length=320)
    reason: str | None = Field(default=None, max_length=300)
    expires_at: datetime | None = None


def _block_out(b: AbuseBlock) -> dict:
    value = "(hashed IP)" if b.kind == "ip" else b.value
    return {"id": b.id, "kind": b.kind, "value": value, "reason": b.reason, "created_at": b.created_at, "expires_at": b.expires_at}


@router.get("/blocks")
def list_blocks(db: Session = Depends(get_db)):
    return {"items": [_block_out(b) for b in db.scalars(select(AbuseBlock).order_by(AbuseBlock.created_at.desc()))]}


@router.post("/blocks", status_code=201)
def add_block(body: BlockIn, db: Session = Depends(get_db)):
    value = body.value.strip().lower()
    if body.kind == "ip":
        value = hash_ip(value)  # store IPs only as keyed hashes
    b = AbuseBlock(kind=body.kind, value=value, reason=body.reason, expires_at=body.expires_at)
    db.add(b)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That block already exists.")
    return _block_out(b)


@router.delete("/blocks/{block_id}", status_code=204)
def remove_block(block_id: uuid.UUID, db: Session = Depends(get_db)):
    b = db.get(AbuseBlock, block_id)
    if b is None:
        raise HTTPException(404, "Block not found")
    db.delete(b)
    db.commit()
    return Response(status_code=204)


class DisableMailboxIn(BaseModel):
    address: str = Field(min_length=3, max_length=320)
    disabled: bool = True


@router.post("/mailboxes/disable")
def disable_mailbox(body: DisableMailboxIn, db: Session = Depends(get_db)):
    mb = db.scalar(select(Mailbox).where(Mailbox.address == body.address.strip().lower()))
    if mb is None:
        raise HTTPException(404, "No mailbox with that address")
    mb.disabled = body.disabled
    db.commit()
    return {"address": mb.address, "disabled": mb.disabled}


@router.post("/cleanup")
def cleanup_now():
    from ..maintenance import run_cleanup

    return run_cleanup()
