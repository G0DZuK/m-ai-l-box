from __future__ import annotations

import asyncio
import json
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SessionLocal, get_db, utcnow
from ..deps import (
    NOT_FOUND,
    Principal,
    SCOPES,
    get_principal,
    is_mailbox_token_holder,
    mailbox_dep,
    require_user,
)
from ..models import ApiKey, Mailbox, Message, User
from ..ratelimit import enforce
from ..schemas import (
    ApiKeyCreated,
    CreateMailboxIn,
    CreateMailboxKeyIn,
    MailboxEnvelope,
    MailboxOut,
    MailboxWithToken,
    OpenMailboxIn,
    PatchMailboxIn,
    api_key_out,
    mailbox_out,
)
from ..security import API_KEY_PREFIX, hash_ip, hash_token, new_token, token_hint
from ..services import create_mailbox, delete_mailbox, rotate_mailbox_token

router = APIRouter(prefix="/api", tags=["mailboxes"])


def mailbox_counts(db: Session, mb: Mailbox) -> MailboxOut:
    total, unread, size = db.execute(
        select(
            func.count(Message.id).filter(Message.deleted_at.is_(None)),
            func.count(Message.id).filter(and_(Message.deleted_at.is_(None), Message.is_read.is_(False))),
            func.coalesce(func.sum(Message.size_bytes), 0),
        ).where(Message.mailbox_id == mb.id)
    ).one()
    return mailbox_out(mb, int(total or 0), int(unread or 0), int(size or 0))


@router.post("/mailboxes", status_code=201, response_model=MailboxWithToken, summary="Create a mailbox")
def create(body: CreateMailboxIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    s = get_settings()
    owner: User | None = None
    if body.save or (p.api_key is not None):
        if p.user is not None:
            owner = p.user
        elif p.api_key is not None and "mailboxes:create" in (p.api_key.scopes or []) and p.api_key.user_id:
            owner = db.get(User, p.api_key.user_id)
        elif body.save:
            raise HTTPException(401, "Sign in to save a mailbox to your account.")
        else:
            raise HTTPException(403, "This API key cannot create mailboxes (needs a user-bound key with mailboxes:create).")
    rl_subject = f"user:{owner.id}" if owner else f"ip:{p.ip}"
    enforce(f"mbcreate:{rl_subject}", s.rl_mailbox_create_per_hour, 3600, "Too many new mailboxes")
    mb, token = create_mailbox(
        db, domain=body.domain, local_part=body.local_part, label=body.label, owner=owner, ip_hash=hash_ip(p.ip)
    )
    return MailboxWithToken(mailbox=mailbox_out(mb), token=token)


@router.post("/mailboxes/open", response_model=MailboxEnvelope, summary="Find a mailbox by its access token")
def open_mailbox(body: OpenMailboxIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    enforce(f"mbopen:{p.ip}", 30, 60, "Too many attempts")
    mb = db.scalar(select(Mailbox).where(Mailbox.token_hash == hash_token(body.token.strip())))
    if mb is None:
        raise HTTPException(404, "No mailbox matches that access key.")
    if mb.owner_user_id is None and mb.expires_at is not None and mb.expires_at <= utcnow():
        raise HTTPException(404, "This mailbox has expired and its messages were deleted.")
    return MailboxEnvelope(mailbox=mailbox_counts(db, mb))


@router.get("/me/mailboxes", summary="Mailboxes saved to my account")
def my_mailboxes(user: User = Depends(require_user), db: Session = Depends(get_db)):
    mbs = db.scalars(select(Mailbox).where(Mailbox.owner_user_id == user.id).order_by(Mailbox.created_at.desc()))
    return {"items": [mailbox_counts(db, mb) for mb in mbs]}


@router.get("/mailboxes/{mailbox_id}", response_model=MailboxOut)
def get_mailbox(mb: Mailbox = Depends(mailbox_dep("messages:read")), db: Session = Depends(get_db)):
    return mailbox_counts(db, mb)


@router.patch("/mailboxes/{mailbox_id}", response_model=MailboxOut)
def patch_mailbox(
    body: PatchMailboxIn, mb: Mailbox = Depends(mailbox_dep("messages:write")), db: Session = Depends(get_db)
):
    mb.label = (body.label or "").strip()[:120] or None
    db.commit()
    return mailbox_counts(db, mb)


def _require_holder_or_owner(p: Principal, mb: Mailbox) -> None:
    """Destructive/administrative mailbox actions are not available to API keys."""
    if p.api_key is not None and not is_mailbox_token_holder(p, mb):
        raise HTTPException(403, "API keys cannot perform this action.")


@router.delete("/mailboxes/{mailbox_id}", status_code=204)
def remove_mailbox(
    mailbox_id: uuid.UUID,
    p: Principal = Depends(get_principal),
    mb: Mailbox = Depends(mailbox_dep("messages:write")),
    db: Session = Depends(get_db),
):
    _require_holder_or_owner(p, mb)
    delete_mailbox(db, mb)
    return Response(status_code=204)


@router.post("/mailboxes/{mailbox_id}/claim", response_model=MailboxOut, summary="Save a mailbox to my account")
def claim(
    mailbox_id: uuid.UUID,
    p: Principal = Depends(get_principal),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    mb = db.get(Mailbox, mailbox_id)
    if mb is None or not is_mailbox_token_holder(p, mb):
        raise HTTPException(404, NOT_FOUND)
    if mb.owner_user_id and mb.owner_user_id != user.id:
        raise HTTPException(409, "This mailbox is already saved to another account.")
    if mb.expires_at is not None and mb.expires_at <= utcnow():
        raise HTTPException(404, "This mailbox has expired and its messages were deleted.")
    mb.owner_user_id = user.id
    mb.expires_at = None
    db.commit()
    return mailbox_counts(db, mb)


@router.post("/mailboxes/{mailbox_id}/release", response_model=MailboxOut, summary="Stop saving a mailbox")
def release(mailbox_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
    from datetime import timedelta

    mb = db.get(Mailbox, mailbox_id)
    if mb is None or mb.owner_user_id != user.id:
        raise HTTPException(404, NOT_FOUND)
    mb.owner_user_id = None
    mb.expires_at = utcnow() + timedelta(hours=get_settings().temp_mailbox_ttl_hours)
    db.commit()
    return mailbox_counts(db, mb)


@router.post("/mailboxes/{mailbox_id}/rotate-token", response_model=MailboxWithToken)
def rotate(
    mailbox_id: uuid.UUID,
    p: Principal = Depends(get_principal),
    mb: Mailbox = Depends(mailbox_dep("messages:write")),
    db: Session = Depends(get_db),
):
    _require_holder_or_owner(p, mb)
    token = rotate_mailbox_token(db, mb)
    return MailboxWithToken(mailbox=mailbox_counts(db, mb), token=token)


# ------------------------------------------------------------------ mailbox-bound API keys

@router.get("/mailboxes/{mailbox_id}/api-keys")
def list_mailbox_keys(
    mailbox_id: uuid.UUID,
    p: Principal = Depends(get_principal),
    mb: Mailbox = Depends(mailbox_dep("messages:read")),
    db: Session = Depends(get_db),
):
    _require_holder_or_owner(p, mb)
    keys = db.scalars(
        select(ApiKey).where(ApiKey.mailbox_id == mb.id, ApiKey.revoked_at.is_(None)).order_by(ApiKey.created_at)
    )
    return {"items": [api_key_out(k) for k in keys]}


@router.post("/mailboxes/{mailbox_id}/api-keys", status_code=201, response_model=ApiKeyCreated)
def create_mailbox_key(
    body: CreateMailboxKeyIn,
    mailbox_id: uuid.UUID,
    p: Principal = Depends(get_principal),
    mb: Mailbox = Depends(mailbox_dep("messages:write")),
    db: Session = Depends(get_db),
):
    _require_holder_or_owner(p, mb)
    scopes = sorted(set(body.scopes) & (SCOPES - {"mailboxes:create"}))
    if not scopes:
        raise HTTPException(422, "Choose at least one of: messages:read, messages:write, attachments:read")
    if db.scalar(select(func.count(ApiKey.id)).where(ApiKey.mailbox_id == mb.id, ApiKey.revoked_at.is_(None))) >= 20:
        raise HTTPException(409, "This mailbox already has 20 API keys. Revoke one first.")
    key = new_token(API_KEY_PREFIX)
    row = ApiKey(mailbox_id=mb.id, name=body.name.strip(), prefix=token_hint(key).rstrip("…"),
                 key_hash=hash_token(key), scopes=scopes)
    db.add(row)
    db.commit()
    return ApiKeyCreated(api_key=api_key_out(row), key=key)


# ------------------------------------------------------------------ live updates (SSE)

@router.get("/mailboxes/{mailbox_id}/events", summary="Server-sent events for new mail")
async def events(request: Request, mailbox_id: uuid.UUID, mb: Mailbox = Depends(mailbox_dep("messages:read"))):
    mailbox_pk = mb.id

    def snapshot():
        db = SessionLocal()
        try:
            if db.get(Mailbox, mailbox_pk) is None:
                return None
            total, unread, latest = db.execute(
                select(
                    func.count(Message.id).filter(Message.deleted_at.is_(None)),
                    func.count(Message.id).filter(and_(Message.deleted_at.is_(None), Message.is_read.is_(False))),
                    func.max(Message.received_at),
                ).where(Message.mailbox_id == mailbox_pk)
            ).one()
            return int(total or 0), int(unread or 0), latest
        finally:
            db.close()

    def new_since(since):
        db = SessionLocal()
        try:
            q = select(Message.id, Message.received_at, Message.subject).where(
                Message.mailbox_id == mailbox_pk, Message.deleted_at.is_(None)
            )
            if since is not None:
                q = q.where(Message.received_at > since)
            return list(db.execute(q.order_by(Message.received_at).limit(20)))
        finally:
            db.close()

    async def stream():
        started = time.monotonic()
        last_state = None
        last_seen = None
        last_ping = time.monotonic()
        first = True
        while time.monotonic() - started < 1800:  # clients reconnect after 30 min
            if await request.is_disconnected():
                break
            snap = await run_in_threadpool(snapshot)
            if snap is None:
                yield "event: gone\ndata: {}\n\n"
                break
            total, unread, latest = snap
            if first:
                last_seen = latest
                first = False
            elif latest is not None and (last_seen is None or latest > last_seen):
                for mid, received, subject in await run_in_threadpool(new_since, last_seen):
                    payload = {"id": str(mid), "received_at": received.isoformat(), "subject": subject[:200]}
                    yield f"event: message\ndata: {json.dumps(payload)}\n\n"
                last_seen = latest
            if (total, unread) != last_state:
                last_state = (total, unread)
                yield f"event: state\ndata: {json.dumps({'message_count': total, 'unread_count': unread})}\n\n"
            if time.monotonic() - last_ping > 15:
                last_ping = time.monotonic()
                yield "event: ping\ndata: {}\n\n"
            await asyncio.sleep(2)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
