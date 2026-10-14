from __future__ import annotations

import hashlib
import hmac
import logging
import smtplib
import socket
import threading
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import pytest

from conftest import bearer, build_email, deliver, make_mailbox, mbx_headers, register

EVIL_HTML = """<html><head><title>t</title><meta http-equiv="refresh" content="0;url=https://evil.example">
<link rel="stylesheet" href="https://evil.example/x.css"><style>@import url(https://evil.example/a.css);
.x{background:url(https://tracker.example/bg.gif)}</style></head>
<body onload="alert(1)"><script>alert('xss')</script>
<p onclick="steal()" style="color:red;background-image:url('https://tracker.example/p.gif')">Hello</p>
<img src="https://tracker.example/open.gif" width="1" height="1"><img src=x onerror=alert(1)>
<a href="javascript:alert(1)">js link</a><a href="https://ok.example/confirm">Confirm</a>
<form action="https://phish.example"><input name="password"><button>Log in</button></form>
<iframe src="https://evil.example"></iframe><object data="x.swf"></object><embed src="x">
<svg onload="alert(1)"><script>alert(2)</script></svg><math><mi>x</mi></math>
<table background="https://tracker.example/t.gif"><tr><td>cell</td></tr></table>
<a href="data:text/html,<script>alert(1)</script>">data link</a></body></html>"""


def _first(client, mid, token):
    return client.get(f"/api/mailboxes/{mid}/messages", headers=mbx_headers(token)).json()["items"][0]


# ------------------------------------------------------------------ unsafe HTML

def test_unsafe_html_is_neutralised(client):
    mid, token, address = make_mailbox(client)
    deliver(build_email(address, html=EVIL_HTML), [address])
    msg = _first(client, mid, token)
    r = client.get(f"/api/mailboxes/{mid}/messages/{msg['id']}/html", headers=mbx_headers(token)).json()
    doc = r["html"].lower()
    body = doc.split("<body>", 1)[1]
    for bad in ("<script", "onload", "onclick", "onerror", "javascript:", "<form", "<input", "<iframe", "<object",
                "<embed", "<svg", "<math", "<link", "http-equiv=\"refresh\"", "evil.example", "tracker.example",
                "@import", "data:text/html", "<button"):
        assert bad not in body, bad
    assert "hello" in body and "https://ok.example/confirm" in body
    assert 'rel="noopener noreferrer nofollow"' in body and 'target="_blank"' in body
    assert r["blocked_remote_images"] >= 4 and r["remote_images_loaded"] is False
    csp = doc.split('content-security-policy" content="', 1)[1].split('"', 1)[0]
    assert "default-src 'none'" in csp and "img-src data:;" in csp and "script-src" not in csp
    assert "form-action 'none'" in csp


def test_remote_images_only_after_explicit_opt_in(client):
    mid, token, address = make_mailbox(client)
    deliver(build_email(address, html='<p>x</p><img src="https://images.example/a.png">'), [address])
    msg = _first(client, mid, token)
    url = f"/api/mailboxes/{mid}/messages/{msg['id']}/html"
    blocked = client.get(url, headers=mbx_headers(token)).json()
    assert "images.example" not in blocked["html"] and blocked["blocked_remote_images"] == 1
    loaded = client.get(url, params={"remote_images": "true"}, headers=mbx_headers(token)).json()
    assert 'src="https://images.example/a.png"' in loaded["html"] and "img-src data: https: http:" in loaded["html"]


def test_inline_cid_images_are_embedded(client):
    from email.message import EmailMessage

    from conftest import PNG

    mid, token, address = make_mailbox(client)
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = "a@origin.example", address, "inline"
    m.set_content("text")
    m.add_alternative('<p><img src="cid:pic1@x"></p>', subtype="html")
    m.get_payload()[1].add_related(PNG, "image", "png", cid="<pic1@x>")
    deliver(m.as_bytes(), [address])
    msg = _first(client, mid, token)
    assert msg["attachment_count"] == 0  # inline images aren't counted as attachments
    html = client.get(f"/api/mailboxes/{mid}/messages/{msg['id']}/html", headers=mbx_headers(token)).json()["html"]
    assert 'src="data:image/png;base64,' in html


# ------------------------------------------------------------------ inbound adapters

def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_smtp_receiver_end_to_end(client):
    from app.inbound.smtp_server import build_controller

    mid, token, address = make_mailbox(client)
    port = _free_port()
    controller = build_controller("127.0.0.1", port)
    controller.start()
    try:
        with smtplib.SMTP("127.0.0.1", port, timeout=10) as smtp:
            smtp.sendmail("app@origin.example", [address], build_email(address, subject="Via real SMTP",
                          attachments=[("hello.txt", "text/plain", b"attached")]))
            with pytest.raises(smtplib.SMTPRecipientsRefused) as exc:
                smtp.sendmail("app@origin.example", ["nobody@test.example"], build_email("nobody@test.example"))
            assert exc.value.recipients["nobody@test.example"][0] == 550
            with pytest.raises(smtplib.SMTPRecipientsRefused):
                smtp.sendmail("app@origin.example", ["victim@gmail.com"], build_email("victim@gmail.com"))  # no relaying
    finally:
        controller.stop()
    msg = _first(client, mid, token)
    assert msg["subject"] == "Via real SMTP" and msg["has_attachments"]


def _sign_raw(secret, ts, frm, to, body):
    msg = f"{ts}.{frm}.{to}.{hashlib.sha256(body).hexdigest()}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def test_cloudflare_raw_webhook_signature(client):
    mid, token, address = make_mailbox(client)
    body = build_email(address, subject="via worker")
    ts = str(int(time.time()))
    headers = {"X-Envelope-From": "a@origin.example", "X-Envelope-To": address, "X-Mailbox-Timestamp": ts,
               "Content-Type": "message/rfc822"}
    good = _sign_raw("webhook-secret-for-tests", ts, "a@origin.example", address, body)
    assert client.post("/api/inbound/raw", content=body, headers={**headers, "X-Mailbox-Signature": "0" * 64}).status_code == 401
    tampered = body.replace(b"via worker", b"via attack")
    assert client.post("/api/inbound/raw", content=tampered, headers={**headers, "X-Mailbox-Signature": good}).status_code == 401
    old_ts = str(int(time.time()) - 3600)
    stale = _sign_raw("webhook-secret-for-tests", old_ts, "a@origin.example", address, body)
    assert client.post("/api/inbound/raw", content=body,
                       headers={**headers, "X-Mailbox-Timestamp": old_ts, "X-Mailbox-Signature": stale}).status_code == 401
    r = client.post("/api/inbound/raw", content=body, headers={**headers, "X-Mailbox-Signature": good})
    assert r.status_code == 200 and r.json()["accepted"] == [address]
    # replay of the same signed request is absorbed by de-duplication
    assert client.post("/api/inbound/raw", content=body, headers={**headers, "X-Mailbox-Signature": good}).status_code == 200
    assert len(client.get(f"/api/mailboxes/{mid}/messages", headers=mbx_headers(token)).json()["items"]) == 1
    # unknown recipient → 404 so the Worker can reject the message at SMTP time
    sig = _sign_raw("webhook-secret-for-tests", ts, "a@origin.example", "nobody@test.example", body)
    r = client.post("/api/inbound/raw", content=body, headers={**headers, "X-Envelope-To": "nobody@test.example",
                                                                 "X-Mailbox-Signature": sig})
    assert r.status_code == 404


def test_mailgun_webhook_signature(client):
    mid, token, address = make_mailbox(client)
    raw = build_email(address, subject="via mailgun", text="Grüße 8bit")
    ts, tok = str(int(time.time())), "x" * 50
    sig = hmac.new(b"mailgun-signing-key-for-tests", f"{ts}{tok}".encode(), hashlib.sha256).hexdigest()
    form = {"recipient": address, "sender": "a@origin.example", "timestamp": ts, "token": tok,
            "body-mime": raw.decode("latin-1")}
    enc = urlencode({**form, "signature": "f" * 64}, encoding="latin-1")
    hdr = {"Content-Type": "application/x-www-form-urlencoded"}
    assert client.post("/api/inbound/mailgun/mime", content=enc, headers=hdr).status_code == 401
    enc = urlencode({**form, "signature": sig}, encoding="latin-1")
    r = client.post("/api/inbound/mailgun/mime", content=enc, headers=hdr)
    assert r.status_code == 200, r.text
    msg = _first(client, mid, token)
    detail = client.get(f"/api/mailboxes/{mid}/messages/{msg['id']}", headers=mbx_headers(token)).json()
    assert detail["subject"] == "via mailgun" and "Grüße" in detail["text_body"]
    # unknown recipient → 406 (Mailgun will not retry)
    enc = urlencode({**form, "recipient": "ghost@test.example", "signature": sig}, encoding="latin-1")
    assert client.post("/api/inbound/mailgun/mime", content=enc, headers=hdr).status_code == 406


def test_blocked_sender_is_refused(client):
    ses = register(client, email="admin@example.org")
    from app.db import SessionLocal
    from app.models import User
    from sqlalchemy import select

    db = SessionLocal()
    db.scalar(select(User)).is_admin = True
    db.commit()
    db.close()
    assert client.post("/api/admin/blocks", json={"kind": "sender_domain", "value": "spam.example"},
                       headers=bearer(ses)).status_code == 201
    mid, token, address = make_mailbox(client)
    res = deliver(build_email(address), [address], mail_from="bot@spam.example")
    assert res.error == "blocked_sender"


# ------------------------------------------------------------------ QA API

def test_wait_endpoint_returns_matching_message(client):
    mid, token, address = make_mailbox(client)
    since = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    deliver(build_email(address, subject="Unrelated"), [address])

    def later():
        time.sleep(1.5)
        deliver(build_email(address, subject="Your code is 771122", text="Your verification code is 771122"), [address])

    threading.Thread(target=later).start()
    r = client.get(f"/api/mailboxes/{mid}/wait", params={"subject": "your code", "since": since, "timeout": 15},
                   headers=mbx_headers(token))
    assert r.status_code == 200, r.text
    assert r.json()["subject"] == "Your code is 771122"
    assert r.json()["otp_codes"][0]["code"] == "771122"


def test_wait_endpoint_times_out(client):
    mid, token, _ = make_mailbox(client)
    r = client.get(f"/api/mailboxes/{mid}/wait", params={"subject": "never", "timeout": 1}, headers=mbx_headers(token))
    assert r.status_code == 408


def test_links_and_otp_in_detail(client):
    mid, token, address = make_mailbox(client)
    deliver(build_email(address, subject="Confirm", text="Your one-time passcode: 5521. Visit https://app.example/x?y=1.",
                        html='<a href="https://app.example/confirm">Confirm account</a>'), [address])
    msg = _first(client, mid, token)
    assert msg["has_otp"]
    d = client.get(f"/api/mailboxes/{mid}/messages/{msg['id']}", headers=mbx_headers(token)).json()
    assert d["otp_codes"][0]["code"] == "5521"
    assert {"url": "https://app.example/confirm", "text": "Confirm account", "source": "html"} in d["links"]
    assert "Your one-time passcode: 5521" in d["text_body"]  # original content preserved


def test_demo_mailbox_is_labelled(client):
    r = client.post("/api/demo/mailbox")
    assert r.status_code == 201
    mb, token = r.json()["mailbox"], r.json()["token"]
    assert mb["is_demo"]
    items = client.get(f"/api/mailboxes/{mb['id']}/messages", headers=mbx_headers(token)).json()["items"]
    assert len(items) == 4 and all(m["is_demo"] for m in items)
    assert all(m["subject"].startswith("[DEMO]") for m in items)


def test_health_and_config(client):
    assert client.get("/api/health").json()["checks"]["database"] == "ok"
    cfg = client.get("/api/config").json()
    assert cfg["domains"] == ["test.example", "second.example"] and cfg["app_name"] == "M-Ai-L Box"


def test_security_headers(client):
    r = client.get("/api/config")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert r.headers["cache-control"] == "no-store"


# ------------------------------------------------------------------ logging hygiene

def test_logs_never_contain_tokens(client, caplog):
    from app.logging_conf import RedactingFilter, redact

    assert "mbx_[REDACTED]" in redact("token mbx_abcdefghijklmnopqrstuvwxyz0123456789")
    assert "Bearer [REDACTED]" in redact("Authorization: Bearer ses_abcdefghijklmnop")
    assert "/api/download/[REDACTED]" in redact("GET /api/download/eyJhbGciOi.abc HTTP/1.1")
    rec = logging.LogRecord("x", logging.INFO, __file__, 1, "key %s", ("mak_supersecretvalue123456",), None)
    RedactingFilter().filter(rec)
    assert "supersecret" not in rec.getMessage()
