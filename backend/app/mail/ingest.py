"""Inbound pipeline shared by every adapter (SMTP, Cloudflare Worker, Mailgun).

    adapter ──► accept_delivery()  : size/abuse checks, recipient routing, raw .eml → object storage,
                                     Delivery row (status=queued), enqueue
    worker  ──► process_delivery() : parse MIME, dedupe, store attachments, create Message rows
                                     (status=processed | retried | failed)

Unknown / expired / disabled recipients are refused at the edge (SMTP 550, webhook 406/404) when
UNKNOWN_RECIPIENT_POLICY=reject (default), or accepted and silently dropped when =discard.
Nothing about message content is ever logged.
"""
from __future__ import annotations

import hashlib
import logging
import uuid
from dataclasses import dataclass, field
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SessionLocal, utcnow
from ..models import AbuseBlock, Attachment, Delivery, Mailbox, Message
from ..ratelimit import limiter
from ..scanning import scan_bytes
from ..security import hash_ip
from ..services import mailbox_has_room, mailbox_is_active
from ..storage import get_storage
from .extract import extract_links, find_otp_codes
from .parser import make_snippet, normalize_message_id, parse_message, sniff_previewable

log = logging.getLogger(__name__)


class TransientError(Exception):
    """Errors worth retrying (storage/database hiccups)."""


@dataclass
class RecipientCheck:
    mailbox: Mailbox | None
    reason: str | None  # None = OK, else: domain | unknown | expired | disabled | blocked | full | rate


@dataclass
class AcceptResult:
    delivery_id: uuid.UUID | None = None
    accepted: list[str] = field(default_factory=list)
    rejected: dict[str, str] = field(default_factory=dict)
    error: str | None = None  # whole-message refusal: too_large | blocked_sender


def split_address(address: str) -> tuple[str, str] | None:
    address = (address or "").strip().strip("<>").lower()
    if address.count("@") != 1:
        return None
    local, domain = address.split("@")
    if not local or not domain:
        return None
    return local.split("+", 1)[0], domain.rstrip(".")  # plus-addressing: name+tag@ → name@


def check_recipient(db: Session, address: str, size_hint: int = 0) -> RecipientCheck:
    s = get_settings()
    parts = split_address(address)
    if parts is None or parts[1] not in s.receiving_domains:
        return RecipientCheck(None, "domain")
    mb = db.scalar(select(Mailbox).where(Mailbox.address == f"{parts[0]}@{parts[1]}"))
    if mb is None:
        return RecipientCheck(None, "unknown")
    if mb.disabled:
        return RecipientCheck(mb, "disabled")
    if not mailbox_is_active(mb):
        return RecipientCheck(mb, "expired")
    if _is_blocked(db, "mailbox", mb.address):
        return RecipientCheck(mb, "blocked")
    if not mailbox_has_room(db, mb, size_hint):
        return RecipientCheck(mb, "full")
    return RecipientCheck(mb, None)


def _is_blocked(db: Session, kind: str, value: str | None) -> bool:
    if not value:
        return False
    now = utcnow()
    return bool(
        db.scalar(
            select(AbuseBlock.id).where(
                AbuseBlock.kind == kind,
                AbuseBlock.value == value.lower(),
                or_(AbuseBlock.expires_at.is_(None), AbuseBlock.expires_at > now),
            )
        )
    )


def sender_blocked(db: Session, mail_from: str | None, remote_ip: str | None) -> bool:
    if remote_ip and _is_blocked(db, "ip", hash_ip(remote_ip)):
        return True
    if mail_from:
        sender = mail_from.strip("<> ").lower()
        if _is_blocked(db, "sender", sender):
            return True
        if "@" in sender and _is_blocked(db, "sender_domain", sender.rsplit("@", 1)[1]):
            return True
    return False


def accept_delivery(
    db: Session,
    raw: bytes,
    recipients: list[str],
    mail_from: str | None,
    source: str,
    remote_ip: str | None = None,
    enqueue: bool = True,
) -> AcceptResult:
    s = get_settings()
    result = AcceptResult()
    if len(raw) > s.max_message_bytes:
        result.error = "too_large"
        return result
    if sender_blocked(db, mail_from, remote_ip):
        result.error = "blocked_sender"
        return result

    mailbox_ids: list[str] = []
    domains: set[str] = set()
    for rcpt in dict.fromkeys(r.strip().lower() for r in recipients if r and r.strip()):
        parts = split_address(rcpt)
        if parts:
            domains.add(parts[1])
        chk = check_recipient(db, rcpt, len(raw))
        if chk.reason is None and chk.mailbox is not None:
            allowed, _ = limiter.hit(f"inbound:mb:{chk.mailbox.id}", s.rl_inbound_per_mailbox_per_hour, 3600)
            if not allowed:
                result.rejected[rcpt] = "rate"
                continue
            if str(chk.mailbox.id) not in mailbox_ids:
                mailbox_ids.append(str(chk.mailbox.id))
            result.accepted.append(rcpt)
        else:
            result.rejected[rcpt] = chk.reason or "unknown"

    raw_sha = hashlib.sha256(raw).hexdigest()
    delivery = Delivery(
        source=source,
        status="queued" if mailbox_ids else "rejected",
        raw_sha256=raw_sha,
        size_bytes=len(raw),
        envelope_from=(mail_from or "")[:320] or None,
        recipients=mailbox_ids,
        recipient_domains=sorted(domains)[:20],
        recipient_count=len(recipients),
        remote_ip_hash=hash_ip(remote_ip),
    )
    if not mailbox_ids:
        delivery.last_error = "no deliverable recipients"
        db.add(delivery)
        db.commit()
        result.delivery_id = delivery.id
        return result

    delivery.id = uuid.uuid4()
    now = utcnow()
    delivery.raw_key = f"raw/{now:%Y/%m/%d}/{delivery.id}.eml"
    get_storage().put_bytes(delivery.raw_key, raw, "message/rfc822")
    db.add(delivery)
    db.commit()
    result.delivery_id = delivery.id
    if enqueue:
        from ..tasks import enqueue_delivery

        enqueue_delivery(delivery.id)
    return result


def dedupe_key_for(message_id: str | None, raw_sha256: str) -> str:
    norm = normalize_message_id(message_id)
    if norm:
        return hashlib.sha256(("mid:" + norm).encode()).hexdigest()
    return raw_sha256


def _search_text(parsed, envelope_to: list[str]) -> str:
    parts = [
        parsed.subject,
        parsed.from_.name if parsed.from_ and parsed.from_.name else "",
        parsed.from_.address if parsed.from_ else "",
        " ".join(f"{a.name or ''} {a.address}" for a in parsed.to + parsed.cc),
        " ".join(envelope_to),
        " ".join(a.filename for a in parsed.attachments),
        parsed.text_body[:200_000],
    ]
    return "\n".join(p for p in parts if p).lower()


def process_delivery(delivery_id: uuid.UUID | str, *, final_attempt: bool = True) -> str:
    """Parse and file a queued delivery. Returns the resulting status.

    Raises TransientError when a retry should be attempted (unless final_attempt).
    """
    s = get_settings()
    storage = get_storage()
    did = uuid.UUID(str(delivery_id))
    db = SessionLocal()
    stored_keys: list[str] = []
    try:
        delivery = db.get(Delivery, did)
        if delivery is None or delivery.status in ("processed", "rejected"):
            return delivery.status if delivery else "missing"
        delivery.status = "processing"
        delivery.attempts += 1
        db.commit()

        if not delivery.raw_key:
            raise RuntimeError("original message is missing")
        raw = storage.get_bytes(delivery.raw_key)
        parsed = parse_message(raw)
        dedupe = dedupe_key_for(parsed.message_id, delivery.raw_sha256)
        otp = find_otp_codes(parsed.subject, parsed.text_body)
        links = extract_links(parsed.html_body, parsed.text_body)
        matched = 0

        for mb_id in delivery.recipients:
            mb = db.get(Mailbox, uuid.UUID(mb_id))
            if mb is None or mb.disabled:
                continue
            exists = db.scalar(
                select(Message.id).where(Message.mailbox_id == mb.id, Message.dedupe_key == dedupe)
            )
            if exists:
                matched += 1  # duplicate delivery: already filed
                continue
            envelope_to = [mb.address]
            msg = Message(
                id=uuid.uuid4(),
                mailbox_id=mb.id,
                delivery_id=delivery.id,
                dedupe_key=dedupe,
                message_id_header=parsed.message_id,
                subject=parsed.subject,
                from_name=parsed.from_.name if parsed.from_ else None,
                from_address=parsed.from_.address if parsed.from_ else None,
                to_addrs=[a.to_dict() for a in parsed.to],
                cc_addrs=[a.to_dict() for a in parsed.cc],
                reply_to=[a.to_dict() for a in parsed.reply_to],
                envelope_from=delivery.envelope_from,
                envelope_to=envelope_to,
                sent_at=parsed.sent_at,
                received_at=delivery.received_at,
                size_bytes=delivery.size_bytes,
                text_body=parsed.text_body[:2_000_000],
                html_body=parsed.html_body[: s.max_html_bytes] if parsed.html_body else None,
                snippet=make_snippet(parsed.text_body),
                headers=parsed.headers,
                otp_codes=otp,
                links=links,
                search_text=_search_text(parsed, envelope_to),
                attachment_count=sum(1 for a in parsed.attachments if not a.is_inline),
                attachments_bytes=sum(len(a.data) for a in parsed.attachments),
                raw_key=delivery.raw_key,
                source=delivery.source,
                is_demo=delivery.source == "demo",
            )
            db.add(msg)
            for att in parsed.attachments:
                aid = uuid.uuid4()
                key = f"att/{mb.id}/{msg.id}/{aid}"
                status = scan_bytes(att.data)
                storage.put_bytes(key, att.data, "application/octet-stream")
                stored_keys.append(key)
                sniff = sniff_previewable(att.data[:16])
                db.add(
                    Attachment(
                        id=aid,
                        message_id=msg.id,
                        mailbox_id=mb.id,
                        filename=att.filename,
                        content_type=att.content_type,
                        size_bytes=len(att.data),
                        sha256=att.sha256,
                        storage_key=key,
                        content_id=att.content_id,
                        is_inline=att.is_inline,
                        scan_status=status,
                        preview_kind=sniff[0] if sniff else None,
                    )
                )
            try:
                db.commit()
                matched += 1
            except IntegrityError:
                # A concurrent worker filed the same message first: treat as duplicate.
                db.rollback()
                for k in stored_keys:
                    storage.delete(k)
                matched += 1
            stored_keys = []

        delivery = db.get(Delivery, did)
        delivery.status = "processed"
        delivery.matched_count = matched
        delivery.processed_at = utcnow()
        delivery.last_error = None
        db.commit()
        return "processed"
    except Exception as exc:
        db.rollback()
        for k in stored_keys:
            try:
                storage.delete(k)
            except Exception:
                pass
        delivery = db.get(Delivery, did)
        if delivery is not None:
            delivery.status = "failed" if final_attempt else "queued"
            delivery.last_error = f"{type(exc).__name__}: {str(exc)[:200]}" if isinstance(exc, (OSError, RuntimeError)) else type(exc).__name__
            db.commit()
        log.warning("delivery %s failed (attempt, final=%s): %s", did, final_attempt, type(exc).__name__)
        if not final_attempt:
            raise TransientError(type(exc).__name__) from exc
        return "failed"
    finally:
        db.close()


def stale_queued_deliveries(db: Session, older_than: timedelta = timedelta(minutes=5)) -> list[uuid.UUID]:
    cutoff = utcnow() - older_than
    return list(
        db.scalars(
            select(Delivery.id).where(
                Delivery.status.in_(("queued", "processing")), Delivery.received_at < cutoff
            ).limit(500)
        )
    )
