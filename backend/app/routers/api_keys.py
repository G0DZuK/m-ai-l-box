from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db, utcnow
from ..deps import SCOPES, Principal, get_principal, is_mailbox_token_holder, require_user
from ..models import ApiKey, Mailbox, User
from ..schemas import ApiKeyCreated, CreateApiKeyIn, api_key_out
from ..security import API_KEY_PREFIX, hash_token, new_token, token_hint

router = APIRouter(prefix="/api/api-keys", tags=["api keys"])


@router.get("")
def list_keys(user: User = Depends(require_user), db: Session = Depends(get_db)):
    owned = select(Mailbox.id).where(Mailbox.owner_user_id == user.id)
    keys = db.scalars(
        select(ApiKey)
        .where(ApiKey.revoked_at.is_(None), or_(ApiKey.user_id == user.id, ApiKey.mailbox_id.in_(owned)))
        .order_by(ApiKey.created_at.desc())
    )
    return {"items": [api_key_out(k) for k in keys]}


@router.post("", status_code=201, response_model=ApiKeyCreated)
def create_key(body: CreateApiKeyIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    bad = set(body.scopes) - SCOPES
    if bad:
        raise HTTPException(422, f"Unknown scopes: {', '.join(sorted(bad))}")
    if db.scalar(select(func.count(ApiKey.id)).where(ApiKey.user_id == user.id, ApiKey.revoked_at.is_(None))) >= 50:
        raise HTTPException(409, "You already have 50 API keys. Revoke one first.")
    mailbox_id = None
    if body.mailbox_id:
        mb = db.get(Mailbox, body.mailbox_id)
        if mb is None or mb.owner_user_id != user.id:
            raise HTTPException(404, "Mailbox not found in your account")
        mailbox_id = mb.id
    scopes = sorted(set(body.scopes) - ({"mailboxes:create"} if mailbox_id else set()))
    if not scopes:
        raise HTTPException(422, "Choose at least one scope")
    key = new_token(API_KEY_PREFIX)
    row = ApiKey(user_id=None if mailbox_id else user.id, mailbox_id=mailbox_id, name=body.name.strip(),
                 prefix=token_hint(key).rstrip("…"), key_hash=hash_token(key), scopes=scopes)
    db.add(row)
    db.commit()
    return ApiKeyCreated(api_key=api_key_out(row), key=key)


@router.delete("/{key_id}", status_code=204)
def revoke_key(key_id: uuid.UUID, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    k = db.get(ApiKey, key_id)
    allowed = False
    if k is not None and k.revoked_at is None:
        if p.user is not None and k.user_id == p.user.id:
            allowed = True
        elif k.mailbox_id is not None:
            mb = db.get(Mailbox, k.mailbox_id)
            if mb is not None and (is_mailbox_token_holder(p, mb) or (p.user is not None and mb.owner_user_id == p.user.id)):
                allowed = True
    if not allowed:
        raise HTTPException(404, "API key not found")
    k.revoked_at = utcnow()
    db.commit()
    return Response(status_code=204)
