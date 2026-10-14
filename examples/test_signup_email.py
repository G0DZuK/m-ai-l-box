"""Example pytest test: sign up in the app under test, then wait for and assert on the verification email.

    pip install pytest httpx
    MAILBOX_URL=http://localhost:8000 pytest examples/test_signup_email.py

Uses only the M-Ai-L Box REST API (see docs/API.md, docs/QA_AUTOMATION.md).
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone

import httpx
import pytest

MAILBOX_URL = os.environ.get("MAILBOX_URL", "http://localhost:8000")


@pytest.fixture()
def mailbox():
    """A fresh, isolated temporary mailbox per test (no account needed)."""
    with httpx.Client(base_url=MAILBOX_URL, timeout=150) as http:
        r = http.post("/api/mailboxes", json={"label": "pytest signup"})
        r.raise_for_status()
        data = r.json()
        http.headers["X-Mailbox-Token"] = data["token"]  # credential lives in a header, never the URL
        yield http, data["mailbox"]
        http.delete(f"/api/mailboxes/{data['mailbox']['id']}")  # clean up


def trigger_signup(email: str) -> None:
    """Replace with a call to the application you are testing (UI automation or API)."""
    import smtplib
    from email.message import EmailMessage

    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = "noreply@app.example", email, "Confirm your account"
    msg.set_content("Welcome! Your verification code is 314159.\nConfirm: https://app.example/confirm?t=abc")
    with smtplib.SMTP(os.environ.get("SMTP_HOST", "127.0.0.1"), int(os.environ.get("SMTP_PORT", "2525"))) as s:
        s.send_message(msg)


def test_signup_sends_verification_code(mailbox):
    http, mb = mailbox
    since = datetime.now(timezone.utc).isoformat()  # ignore anything older than this test

    trigger_signup(mb["address"])

    r = http.get(f"/api/mailboxes/{mb['id']}/wait",
                 params={"subject": "confirm your account", "since": since, "timeout": 60})
    assert r.status_code == 200, f"no email arrived: {r.text}"
    message = r.json()

    assert message["from"]["address"] == "noreply@app.example"
    assert message["otp_codes"], "expected a one-time code"
    code = message["otp_codes"][0]["code"]
    assert re.fullmatch(r"\d{6}", code)
    confirm = [link["url"] for link in message["links"] if "/confirm" in link["url"]]
    assert confirm, "expected a confirmation link"
    # Delivery latency as measured by M-Ai-L Box's own clock (sent_at is the sender's, untrusted)
    received = datetime.fromisoformat(message["received_at"])
    assert (received - datetime.fromisoformat(since)).total_seconds() < 60
