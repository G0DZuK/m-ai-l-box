"""Test configuration: SQLite + local object storage + inline processing (no Docker needed)."""
from __future__ import annotations

import os
import shutil
import tempfile
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
from datetime import datetime, timezone

import pytest

_TMP = tempfile.mkdtemp(prefix="mailbox-tests-")
os.environ.update(
    ENVIRONMENT="test",
    SECRET_KEY="test-secret-key-0123456789abcdef",
    DATABASE_URL=f"sqlite:///{_TMP}/test.db".replace("\\", "/"),
    STORAGE_BACKEND="local",
    STORAGE_LOCAL_PATH=os.path.join(_TMP, "objects"),
    REDIS_URL="",
    PROCESS_INLINE="true",
    RECEIVING_DOMAINS='["test.example", "second.example"]',
    INBOUND_ADAPTERS='["smtp", "cloudflare", "mailgun"]',
    INBOUND_WEBHOOK_SECRET="webhook-secret-for-tests",
    MAILGUN_WEBHOOK_SIGNING_KEY="mailgun-signing-key-for-tests",
    DEMO_MODE="true",
    USER_QUOTA_BYTES=str(200 * 1024),
    TEMP_MAILBOX_MAX_MESSAGES="5",
    RL_MAILBOX_CREATE_PER_HOUR="1000",
    RL_AUTH_PER_MINUTE="1000",
    RL_API_PER_MINUTE="10000",
)

from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, get_engine  # noqa: E402
from app.main import create_app  # noqa: E402
from app.ratelimit import limiter  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    limiter.reset()
    objects = os.environ["STORAGE_LOCAL_PATH"]
    shutil.rmtree(objects, ignore_errors=True)
    os.makedirs(objects, exist_ok=True)
    yield


@pytest.fixture()
def client():
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture()
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
       b"\x00\x00\x00\rIDATx\xdac\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d\x00\x00\x00\x00IEND\xaeB`\x82")


def make_mailbox(client, **body):
    r = client.post("/api/mailboxes", json=body)
    assert r.status_code == 201, r.text
    data = r.json()
    return data["mailbox"]["id"], data["token"], data["mailbox"]["address"]


def mbx_headers(token: str) -> dict:
    return {"X-Mailbox-Token": token}


def build_email(to: str, subject: str = "Hello", text: str = "Body text", html: str | None = None,
                sender: str = "Sender <sender@origin.example>", message_id: str | None = None,
                attachments: list[tuple[str, str, bytes]] | None = None) -> bytes:
    m = EmailMessage()
    m["From"] = sender
    m["To"] = to
    m["Subject"] = subject
    m["Date"] = format_datetime(datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc))
    m["Message-ID"] = message_id or make_msgid(domain="origin.example")
    m.set_content(text)
    if html:
        m.add_alternative(html, subtype="html")
    for name, ctype, data in attachments or []:
        maintype, subtype = ctype.split("/")
        m.add_attachment(data, maintype=maintype, subtype=subtype, filename=name)
    return m.as_bytes()


def deliver(raw: bytes, rcpts: list[str], source: str = "smtp", mail_from: str = "sender@origin.example"):
    from app.mail.ingest import accept_delivery

    db = SessionLocal()
    try:
        return accept_delivery(db, raw, rcpts, mail_from, source)
    finally:
        db.close()


def register(client, email="qa@example.org", password="correct horse battery"):
    r = client.post("/api/auth/register", json={"email": email, "password": password})
    assert r.status_code == 201, r.text
    return r.json()["token"]


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
