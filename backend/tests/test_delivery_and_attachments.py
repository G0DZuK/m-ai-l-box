from __future__ import annotations

import time

from conftest import PNG, bearer, build_email, deliver, make_mailbox, mbx_headers, register



def _messages(client, mid, token, **params):
    return client.get(f"/api/mailboxes/{mid}/messages", params=params, headers=mbx_headers(token)).json()["items"]


# ------------------------------------------------------------------ duplicates

def test_duplicate_delivery_same_bytes_creates_one_message(client):
    mid, token, address = make_mailbox(client)
    raw = build_email(address, subject="once")
    deliver(raw, [address])
    deliver(raw, [address])                     # provider retry with identical content
    assert len(_messages(client, mid, token)) == 1


def test_duplicate_message_id_with_different_transport_headers(client):
    mid, token, address = make_mailbox(client)
    raw = build_email(address, subject="same id", message_id="<fixed-123@origin.example>")
    deliver(raw, [address])
    deliver(b"Received: from relay2.example by mx\r\n" + raw, [address], source="mailgun")
    assert len(_messages(client, mid, token)) == 1


def test_distinct_messages_are_kept(client):
    mid, token, address = make_mailbox(client)
    deliver(build_email(address, subject="one"), [address])
    deliver(build_email(address, subject="two"), [address])
    assert {m["subject"] for m in _messages(client, mid, token)} == {"one", "two"}


def test_same_delivery_to_two_mailboxes_files_a_copy_in_each(client):
    a_id, a_tok, a_addr = make_mailbox(client)
    b_id, b_tok, b_addr = make_mailbox(client)
    res = deliver(build_email(f"{a_addr}, {b_addr}"), [a_addr, b_addr, a_addr])
    assert sorted(res.accepted) == sorted([a_addr, b_addr])
    assert len(_messages(client, a_id, a_tok)) == 1 and len(_messages(client, b_id, b_tok)) == 1


def test_failed_processing_is_visible_and_retryable(client, db, monkeypatch):
    from sqlalchemy import select

    from app.mail import ingest
    from app.models import Delivery

    mid, token, address = make_mailbox(client)
    original = ingest.parse_message
    monkeypatch.setattr(ingest, "parse_message", lambda raw: (_ for _ in ()).throw(RuntimeError("boom")))
    deliver(build_email(address), [address])
    d = db.scalar(select(Delivery))
    db.refresh(d)
    assert d.status == "failed" and d.attempts == 1 and "boom" in d.last_error
    assert _messages(client, mid, token) == []
    monkeypatch.setattr(ingest, "parse_message", original)
    # an admin retries it
    admin = register(client, email="admin@example.org")
    from app.models import User

    u = db.scalar(select(User).where(User.email == "admin@example.org"))
    u.is_admin = True
    db.commit()
    failed = client.get("/api/admin/deliveries", params={"status": "failed"}, headers=bearer(admin)).json()["items"]
    assert len(failed) == 1 and "subject" not in failed[0]
    r = client.post(f"/api/admin/deliveries/{failed[0]['id']}/retry", headers=bearer(admin))
    assert r.json()["status"] == "processed"
    assert len(_messages(client, mid, token)) == 1


# ------------------------------------------------------------------ attachments

def test_attachment_download_via_short_lived_link(client):
    mid, token, address = make_mailbox(client)
    deliver(build_email(address, attachments=[("report.pdf", "application/pdf", b"%PDF-1.4 test"),
                                               ("pic.png", "image/png", PNG)]), [address])
    msg = _messages(client, mid, token)[0]
    assert msg["has_attachments"] and msg["attachment_count"] == 2
    detail = client.get(f"/api/mailboxes/{mid}/messages/{msg['id']}", headers=mbx_headers(token)).json()
    atts = {a["filename"]: a for a in detail["attachments"]}
    assert atts["report.pdf"]["previewable"] == "pdf" and atts["pic.png"]["previewable"] == "image"
    link = client.post(f"/api/mailboxes/{mid}/attachments/{atts['report.pdf']['id']}/download-link",
                       headers=mbx_headers(token)).json()
    assert link["url"].startswith("/api/download/") and link["expires_in"] > 0
    r = client.get(link["url"])
    assert r.status_code == 200 and r.content == b"%PDF-1.4 test"
    assert r.headers["content-type"] == "application/octet-stream"
    assert r.headers["content-disposition"].startswith('attachment; filename="report.pdf"')
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in r.headers["content-security-policy"]
    inline = client.post(f"/api/mailboxes/{mid}/attachments/{atts['pic.png']['id']}/download-link",
                         params={"disposition": "inline"}, headers=mbx_headers(token)).json()
    r = client.get(inline["url"])
    assert r.headers["content-type"] == "image/png" and r.headers["content-disposition"].startswith("inline")


def test_attachment_links_are_authorised_and_tamper_proof(client, monkeypatch):
    mid, token, address = make_mailbox(client)
    other_id, other_tok, _ = make_mailbox(client)
    deliver(build_email(address, attachments=[("secret.txt", "text/plain", b"top secret")]), [address])
    msg = _messages(client, mid, token)[0]
    aid = client.get(f"/api/mailboxes/{mid}/messages/{msg['id']}", headers=mbx_headers(token)).json()["attachments"][0]["id"]
    # other mailbox's token, through either mailbox path
    assert client.post(f"/api/mailboxes/{mid}/attachments/{aid}/download-link", headers=mbx_headers(other_tok)).status_code == 404
    assert client.post(f"/api/mailboxes/{other_id}/attachments/{aid}/download-link", headers=mbx_headers(other_tok)).status_code == 404
    # inline preview of a non-previewable type is refused
    assert client.post(f"/api/mailboxes/{mid}/attachments/{aid}/download-link", params={"disposition": "inline"},
                       headers=mbx_headers(token)).status_code == 422
    url = client.post(f"/api/mailboxes/{mid}/attachments/{aid}/download-link", headers=mbx_headers(token)).json()["url"]
    body, sig = url.rsplit("/", 1)[1].split(".")
    assert client.get(f"/api/download/{body}.{sig[:-2]}AA").status_code == 410            # bad signature
    assert client.get("/api/download/eyJrIjoiLi4vLi4vZXRjL3Bhc3N3ZCJ9.x").status_code == 410  # forged key
    # expiry
    from app import security

    real_time = time.time
    monkeypatch.setattr(security.time, "time", lambda: real_time() + 3600)
    assert client.get(url).status_code == 410


def test_infected_attachment_cannot_be_downloaded(client, monkeypatch):
    from app.mail import ingest

    monkeypatch.setattr(ingest, "scan_bytes", lambda data: "infected" if b"EICAR" in data else "clean")
    mid, token, address = make_mailbox(client)
    deliver(build_email(address, attachments=[("eicar.com", "application/octet-stream", b"X5O!P%@AP EICAR test"),
                                               ("ok.txt", "text/plain", b"fine")]), [address])
    msg = _messages(client, mid, token)[0]
    atts = {a["filename"]: a for a in client.get(f"/api/mailboxes/{mid}/messages/{msg['id']}", headers=mbx_headers(token)).json()["attachments"]}
    assert atts["eicar.com"]["scan_status"] == "infected" and atts["ok.txt"]["scan_status"] == "clean"
    assert client.post(f"/api/mailboxes/{mid}/attachments/{atts['eicar.com']['id']}/download-link",
                       headers=mbx_headers(token)).status_code == 403


def test_attachments_view_search_and_sort(client):
    mid, token, address = make_mailbox(client)
    deliver(build_email(address, subject="Invoices", attachments=[("b-invoice.pdf", "application/pdf", b"%PDF-1" * 100)]), [address])
    deliver(build_email(address, subject="Photos", attachments=[("a-photo.png", "image/png", PNG)]), [address])
    r = client.get(f"/api/mailboxes/{mid}/attachments", params={"sort": "name", "order": "asc"}, headers=mbx_headers(token)).json()
    assert [a["filename"] for a in r["items"]] == ["a-photo.png", "b-invoice.pdf"]
    assert r["items"][0]["message_subject"] == "Photos"
    r = client.get(f"/api/mailboxes/{mid}/attachments", params={"q": "invoice"}, headers=mbx_headers(token)).json()
    assert [a["filename"] for a in r["items"]] == ["b-invoice.pdf"]


def test_eml_download_and_raw_view(client):
    mid, token, address = make_mailbox(client)
    raw = build_email(address, subject="raw me")
    deliver(raw, [address])
    msg = _messages(client, mid, token)[0]
    rv = client.get(f"/api/mailboxes/{mid}/messages/{msg['id']}/raw", headers=mbx_headers(token)).json()
    assert "Subject: raw me" in rv["raw"] and rv["truncated"] is False
    link = client.post(f"/api/mailboxes/{mid}/messages/{msg['id']}/download-link", headers=mbx_headers(token)).json()
    r = client.get(link["url"])
    assert r.content == raw and r.headers["content-type"].startswith("message/rfc822")
    assert ".eml" in r.headers["content-disposition"]


def test_trash_restore_and_permanent_delete_removes_objects(client):
    import os

    mid, token, address = make_mailbox(client)
    deliver(build_email(address, attachments=[("f.bin", "application/octet-stream", b"1234")]), [address])
    msg = _messages(client, mid, token)[0]
    h = mbx_headers(token)
    assert client.post(f"/api/mailboxes/{mid}/messages/{msg['id']}/trash", headers=h).json()["in_trash"]
    assert _messages(client, mid, token) == [] and len(_messages(client, mid, token, folder="trash")) == 1
    assert not client.post(f"/api/mailboxes/{mid}/messages/{msg['id']}/restore", headers=h).json()["in_trash"]
    root = os.environ["STORAGE_LOCAL_PATH"]
    count = lambda: sum(len(files) for _, _, files in os.walk(root))  # noqa: E731
    assert count() == 2   # original .eml + attachment
    assert client.delete(f"/api/mailboxes/{mid}/messages/{msg['id']}", headers=h).status_code == 204
    assert count() == 0
    assert client.get(f"/api/mailboxes/{mid}/messages/{msg['id']}", headers=h).status_code == 404


def test_search_filters(client):
    mid, token, address = make_mailbox(client)
    deliver(build_email(address, subject="Order shipped", text="tracking number ZX9", sender="Shop <shop@store.example>"), [address])
    deliver(build_email(address, subject="Newsletter", text="weekly digest", sender="News <news@paper.example>"), [address])
    s = lambda **p: [m["subject"] for m in _messages(client, mid, token, **p)]  # noqa: E731
    assert s(q="zx9") == ["Order shipped"]
    assert s(**{"from": "paper.example"}) == ["Newsletter"]
    assert s(subject="order") == ["Order shipped"]
    assert s(to=address) and len(s(to=address)) == 2
    assert s(q="100%_literal") == []
    assert len(s(after="2000-01-01")) == 2 and s(before="2000-01-01") == []


# ------------------------------------------------------------------ quotas and limits

def test_temporary_mailbox_message_cap(client):
    mid, token, address = make_mailbox(client)
    for i in range(5):
        assert deliver(build_email(address, subject=f"m{i}"), [address]).accepted
    res = deliver(build_email(address, subject="over"), [address])
    assert res.accepted == [] and res.rejected[address] == "full"


def test_message_size_limit(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "max_message_bytes", 2000)
    mid, token, address = make_mailbox(client)
    res = deliver(build_email(address, text="x" * 5000), [address])
    assert res.error == "too_large"


def test_upload_quota_enforced(client):
    ses = register(client)  # USER_QUOTA_BYTES = 200 KiB in tests
    h = bearer(ses)
    r = client.post("/api/files", files={"file": ("a.bin", b"a" * 150_000, "application/octet-stream")}, headers=h)
    assert r.status_code == 201
    r = client.post("/api/files", files={"file": ("b.bin", b"b" * 100_000, "application/octet-stream")}, headers=h)
    assert r.status_code == 507
    usage = client.get("/api/auth/me", headers=h).json()["usage"]
    assert usage["used_bytes"] == 150_000 and usage["quota_bytes"] == 200 * 1024
    assert client.post("/api/files", files={"file": ("../../x.png", PNG, "image/png")}, headers=h).json()["filename"] == "x.png"


def test_upload_size_limit(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "max_upload_bytes", 1000)
    ses = register(client)
    r = client.post("/api/files", files={"file": ("big.bin", b"z" * 5000, "application/octet-stream")}, headers=bearer(ses))
    assert r.status_code == 413


def test_saved_mailbox_counts_toward_quota(client):
    ses = register(client)
    r = client.post("/api/mailboxes", json={"save": True}, headers=bearer(ses))
    mid, address = r.json()["mailbox"]["id"], r.json()["mailbox"]["address"]
    assert deliver(build_email(address, attachments=[("a.bin", "application/octet-stream", b"q" * 100_000)]), [address]).accepted
    # ~137 KB stored (base64) → a second one exceeds the 200 KiB quota
    res = deliver(build_email(address, attachments=[("b.bin", "application/octet-stream", b"r" * 100_000)]), [address])
    assert res.rejected.get(address) == "full"
    assert client.get(f"/api/mailboxes/{mid}", headers=bearer(ses)).json()["message_count"] == 1


def test_files_are_private_and_save_to_files(client):
    a = register(client)
    b = register(client, email="b@example.org")
    fid = client.post("/api/files", files={"file": ("n.txt", b"note", "text/plain")}, headers=bearer(a)).json()["id"]
    assert client.post(f"/api/files/{fid}/download-link", headers=bearer(b)).status_code == 404
    assert client.delete(f"/api/files/{fid}", headers=bearer(b)).status_code == 404
    url = client.post(f"/api/files/{fid}/download-link", headers=bearer(a)).json()["url"]
    assert client.get(url).content == b"note"
    # save an attachment from a mailbox into personal storage
    mid, token, address = make_mailbox(client)
    deliver(build_email(address, attachments=[("keep.pdf", "application/pdf", b"%PDF-1.4 keep")]), [address])
    msg = _messages(client, mid, token)[0]
    aid = client.get(f"/api/mailboxes/{mid}/messages/{msg['id']}", headers=mbx_headers(token)).json()["attachments"][0]["id"]
    r = client.post(f"/api/mailboxes/{mid}/attachments/{aid}/save-to-files", headers={**bearer(a), **mbx_headers(token)})
    assert r.status_code == 201 and r.json()["source"] == "attachment"
    names = [f["filename"] for f in client.get("/api/files", headers=bearer(a)).json()["items"]]
    assert "keep.pdf" in names


def test_retention_cleanup(client, db):
    from datetime import timedelta

    from sqlalchemy import func, select

    from app.db import utcnow
    from app.maintenance import run_cleanup
    from app.models import Mailbox, Message

    mid, token, address = make_mailbox(client)
    deliver(build_email(address), [address])
    keep_id, keep_tok, keep_addr = make_mailbox(client)
    deliver(build_email(keep_addr, subject="trash me"), [keep_addr])
    msg = _messages(client, keep_id, keep_tok)[0]
    client.post(f"/api/mailboxes/{keep_id}/messages/{msg['id']}/trash", headers=mbx_headers(keep_tok))
    import uuid

    db.get(Mailbox, uuid.UUID(mid)).expires_at = utcnow() - timedelta(hours=1)
    db.get(Message, uuid.UUID(msg["id"])).deleted_at = utcnow() - timedelta(days=30)
    db.commit()
    counts = run_cleanup()
    assert counts["expired_mailboxes"] == 1 and counts["trash_messages"] == 1
    db.expire_all()
    assert db.scalar(select(func.count(Message.id))) == 0
    assert db.get(Mailbox, uuid.UUID(keep_id)) is not None


def test_celery_task_path(client, monkeypatch):
    """With PROCESS_INLINE off, deliveries go through the Celery task (run eagerly here)."""
    from app.config import get_settings
    from app.tasks import celery_app

    monkeypatch.setattr(get_settings(), "process_inline", False)
    monkeypatch.setitem(celery_app.conf, "task_always_eager", True)
    mid, token, address = make_mailbox(client)
    deliver(build_email(address, subject="via celery"), [address])
    assert [m["subject"] for m in _messages(client, mid, token)] == ["via celery"]


def test_stale_queued_deliveries_are_found(client, db):
    from datetime import timedelta

    from app.db import utcnow
    from app.mail.ingest import stale_queued_deliveries
    from app.models import Delivery

    d = Delivery(source="smtp", status="queued", raw_sha256="0" * 64, size_bytes=1,
                 received_at=utcnow() - timedelta(minutes=10))
    db.add(d)
    db.commit()
    assert d.id in stale_queued_deliveries(db)
