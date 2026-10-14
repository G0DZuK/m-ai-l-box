"""SQLAlchemy models. Keep these portable (PostgreSQL in production, SQLite in tests)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, UTCDateTime, utcnow

JSONType = JSON().with_variant(JSONB(), "postgresql")


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    quota_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # None = default quota
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    mailboxes: Mapped[list[Mailbox]] = relationship(back_populates="owner")


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    user: Mapped[User] = relationship()


class Mailbox(Base):
    __tablename__ = "mailboxes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    address: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    local_part: Mapped[str] = mapped_column(String(64))
    domain: Mapped[str] = mapped_column(String(253))
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    token_hint: Mapped[str] = mapped_column(String(16))
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)
    last_accessed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    owner: Mapped[User | None] = relationship(back_populates="mailboxes")


class Delivery(Base):
    """One inbound transmission (SMTP DATA or webhook POST). Holds metadata only."""

    __tablename__ = "deliveries"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    source: Mapped[str] = mapped_column(String(20))  # smtp | cloudflare | mailgun | demo
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    raw_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    raw_sha256: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    envelope_from: Mapped[str | None] = mapped_column(String(320), nullable=True)
    recipients: Mapped[list] = mapped_column(JSONType, default=list)  # accepted mailbox ids (str)
    recipient_domains: Mapped[list] = mapped_column(JSONType, default=list)
    recipient_count: Mapped[int] = mapped_column(Integer, default=0)
    matched_count: Mapped[int] = mapped_column(Integer, default=0)
    remote_ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    processed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint("mailbox_id", "dedupe_key", name="uq_messages_mailbox_dedupe"),
        Index("ix_messages_mailbox_received", "mailbox_id", "received_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    mailbox_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mailboxes.id", ondelete="CASCADE"), index=True)
    delivery_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("deliveries.id", ondelete="SET NULL"), nullable=True
    )
    dedupe_key: Mapped[str] = mapped_column(String(64))
    message_id_header: Mapped[str | None] = mapped_column(String(998), nullable=True)
    subject: Mapped[str] = mapped_column(Text, default="")
    from_name: Mapped[str | None] = mapped_column(String(320), nullable=True)
    from_address: Mapped[str | None] = mapped_column(String(320), nullable=True)
    to_addrs: Mapped[list] = mapped_column(JSONType, default=list)
    cc_addrs: Mapped[list] = mapped_column(JSONType, default=list)
    reply_to: Mapped[list] = mapped_column(JSONType, default=list)
    envelope_from: Mapped[str | None] = mapped_column(String(320), nullable=True)
    envelope_to: Mapped[list] = mapped_column(JSONType, default=list)
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    text_body: Mapped[str] = mapped_column(Text, default="")
    html_body: Mapped[str | None] = mapped_column(Text, nullable=True)  # unsanitised; sanitised on render
    snippet: Mapped[str] = mapped_column(String(200), default="")
    headers: Mapped[list] = mapped_column(JSONType, default=list)
    otp_codes: Mapped[list] = mapped_column(JSONType, default=list)
    links: Mapped[list] = mapped_column(JSONType, default=list)
    search_text: Mapped[str] = mapped_column(Text, default="")  # lower-cased haystack for portable search
    attachment_count: Mapped[int] = mapped_column(Integer, default=0)
    attachments_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    raw_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="smtp")
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    is_starred: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    attachments: Mapped[list[Attachment]] = relationship(
        back_populates="message", cascade="all, delete-orphan", passive_deletes=True
    )


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    mailbox_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mailboxes.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    storage_key: Mapped[str] = mapped_column(String(200))
    content_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_inline: Mapped[bool] = mapped_column(Boolean, default=False)
    scan_status: Mapped[str] = mapped_column(String(20), default="not_scanned")
    preview_kind: Mapped[str | None] = mapped_column(String(10), nullable=True)  # image | pdf (sniffed)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    message: Mapped[Message] = relationship(back_populates="attachments")


class StoredFile(Base):
    """Personal storage for signed-in users."""

    __tablename__ = "stored_files"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    storage_key: Mapped[str] = mapped_column(String(200))
    source: Mapped[str] = mapped_column(String(20), default="upload")
    scan_status: Mapped[str] = mapped_column(String(20), default="not_scanned")
    preview_kind: Mapped[str | None] = mapped_column(String(10), nullable=True)  # image | pdf (sniffed)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    mailbox_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("mailboxes.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    prefix: Mapped[str] = mapped_column(String(16))
    key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    scopes: Mapped[list] = mapped_column(JSONType, default=list)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class AbuseBlock(Base):
    __tablename__ = "abuse_blocks"
    __table_args__ = (UniqueConstraint("kind", "value", name="uq_abuse_kind_value"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    kind: Mapped[str] = mapped_column(String(20))  # sender | sender_domain | ip | mailbox
    value: Mapped[str] = mapped_column(String(320))
    reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
