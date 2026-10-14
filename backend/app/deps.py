"""Authentication and authorisation dependencies. Every mailbox-scoped route goes through `authorize_mailbox`."""
from __future__ import annotations

import hmac
import uuid
from dataclasses import dataclass
from datetime import timedelta

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db, utcnow
from .models import ApiKey, Mailbox, User, UserSession
from .ratelimit import enforce
from .security import API_KEY_PREFIX, MAILBOX_PREFIX, SESSION_PREFIX, hash_token

SCOPES = {"mailboxes:create", "messages:read", "messages:write", "attachments:read"}
NOT_FOUND = "Mailbox not found, or you do not have access to it."


@dataclass
class Principal:
    ip: str
    user: User | None = None
    session: UserSession | None = None
    api_key: ApiKey | None = None
    mailbox_token_hash: str | None = None

    @property
    def is_anonymous(self) -> bool:
        return not (self.user or self.api_key or self.mailbox_token_hash)


def client_ip(request: Request) -> str:
    if get_settings().trust_proxy_headers:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
        real = request.headers.get("x-real-ip")
        if real:
            return real.strip()
    return request.client.host if request.client else "unknown"


def get_principal(
    request: Request,
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
    x_mailbox_token: str | None = Header(default=None),
) -> Principal:
    s = get_settings()
    p = Principal(ip=client_ip(request))
    now = utcnow()
    if authorization:
        scheme, _, cred = authorization.partition(" ")
        cred = cred.strip()
        if scheme.lower() != "bearer" or not cred:
            raise HTTPException(401, "Malformed Authorization header", headers={"WWW-Authenticate": "Bearer"})
        if cred.startswith(SESSION_PREFIX):
            sess = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(cred)))
            if sess is None or sess.expires_at < now or sess.user.disabled:
                raise HTTPException(401, "Your session has expired. Please sign in again.")
            p.session, p.user = sess, sess.user
            if sess.last_used_at is None or now - sess.last_used_at > timedelta(minutes=10):
                sess.last_used_at = now
                db.commit()
        elif cred.startswith(API_KEY_PREFIX):
            key = db.scalar(select(ApiKey).where(ApiKey.key_hash == hash_token(cred)))
            if key is None or key.revoked_at is not None:
                raise HTTPException(401, "Invalid or revoked API key")
            if key.user_id:
                owner = db.get(User, key.user_id)
                if owner is None or owner.disabled:
                    raise HTTPException(401, "Invalid or revoked API key")
            p.api_key = key
            if key.last_used_at is None or now - key.last_used_at > timedelta(minutes=1):
                key.last_used_at = now
                db.commit()
        elif cred.startswith(MAILBOX_PREFIX):
            # Accept a mailbox token as a bearer credential too (handy for curl/CI)
            p.mailbox_token_hash = hash_token(cred)
        else:
            raise HTTPException(401, "Unrecognised credential")
    if x_mailbox_token:
        tok = x_mailbox_token.strip()
        if not tok.startswith(MAILBOX_PREFIX):
            raise HTTPException(401, "Malformed mailbox token")
        p.mailbox_token_hash = hash_token(tok)

    if p.api_key:
        rl_key = f"api:key:{p.api_key.id}"
    elif p.user:
        rl_key = f"api:user:{p.user.id}"
    elif p.mailbox_token_hash:
        rl_key = f"api:mbx:{p.mailbox_token_hash[:16]}"
    else:
        rl_key = f"api:ip:{p.ip}"
    enforce(rl_key, s.rl_api_per_minute, 60, "Too many requests")
    return p


def require_user(p: Principal = Depends(get_principal)) -> User:
    if p.user is None:
        raise HTTPException(401, "Please sign in to use this feature.")
    return p.user


def require_admin(user: User = Depends(require_user)) -> User:
    if not user.is_admin:
        raise HTTPException(403, "Administrator access required.")
    return user


def authorize_mailbox(db: Session, p: Principal, mailbox_id: uuid.UUID, scope: str) -> Mailbox:
    mb = db.get(Mailbox, mailbox_id)
    if mb is None:
        raise HTTPException(404, NOT_FOUND)
    allowed = False
    if p.mailbox_token_hash and hmac.compare_digest(p.mailbox_token_hash, mb.token_hash):
        allowed = True
    elif p.user is not None and mb.owner_user_id == p.user.id:
        allowed = True
    elif p.api_key is not None and scope in (p.api_key.scopes or []):
        k = p.api_key
        if k.mailbox_id == mb.id or (k.user_id is not None and k.user_id == mb.owner_user_id):
            allowed = True
    if not allowed:
        raise HTTPException(404, NOT_FOUND)
    now = utcnow()
    if mb.owner_user_id is None and mb.expires_at is not None and mb.expires_at <= now:
        raise HTTPException(404, "This mailbox has expired and its messages were deleted.")
    if mb.disabled:
        raise HTTPException(403, "This mailbox has been disabled by the administrator.")
    if mb.last_accessed_at is None or now - mb.last_accessed_at > timedelta(minutes=5):
        mb.last_accessed_at = now
        db.commit()
    return mb


def mailbox_dep(scope: str):
    def dep(
        mailbox_id: uuid.UUID, p: Principal = Depends(get_principal), db: Session = Depends(get_db)
    ) -> Mailbox:
        return authorize_mailbox(db, p, mailbox_id, scope)

    return dep


def is_mailbox_token_holder(p: Principal, mb: Mailbox) -> bool:
    return bool(p.mailbox_token_hash and hmac.compare_digest(p.mailbox_token_hash, mb.token_hash))
