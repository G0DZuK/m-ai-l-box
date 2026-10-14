from __future__ import annotations

from conftest import bearer, build_email, deliver, make_mailbox, mbx_headers, register


def _first_message(client, mid, token):
    r = client.get(f"/api/mailboxes/{mid}/messages", headers=mbx_headers(token))
    assert r.status_code == 200, r.text
    return r.json()["items"]


def test_core_flow_create_receive_list_open(client):
    mid, token, address = make_mailbox(client)
    assert address.endswith("@test.example")
    res = deliver(build_email(address, subject="Welcome aboard"), [address])
    assert res.accepted == [address]
    items = _first_message(client, mid, token)
    assert len(items) == 1 and items[0]["subject"] == "Welcome aboard" and items[0]["is_read"] is False
    assert items[0]["from"]["address"] == "sender@origin.example"
    detail = client.get(f"/api/mailboxes/{mid}/messages/{items[0]['id']}", headers=mbx_headers(token)).json()
    assert detail["text_body"].strip() == "Body text"
    assert detail["sent_at"].startswith("2026-01-02T03:04:05")   # sender's Date header
    assert detail["received_at"] != detail["sent_at"]              # our clock, distinct field
    assert detail["delivery_source"] == "smtp"


def test_address_knowledge_grants_nothing(client):
    mid, token, address = make_mailbox(client)
    deliver(build_email(address), [address])
    # no credential
    assert client.get(f"/api/mailboxes/{mid}/messages").status_code == 404
    # wrong token
    assert client.get(f"/api/mailboxes/{mid}/messages", headers=mbx_headers("mbx_" + "A" * 43)).status_code == 404
    # the address itself is not a credential
    assert client.post("/api/mailboxes/open", json={"token": address}).status_code == 404


def test_mailboxes_are_isolated(client):
    a_id, a_tok, a_addr = make_mailbox(client)
    b_id, b_tok, b_addr = make_mailbox(client)
    deliver(build_email(a_addr, subject="for A"), [a_addr])
    a_msg = _first_message(client, a_id, a_tok)[0]
    # B's token cannot read A's mailbox or A's message through B's mailbox path
    assert client.get(f"/api/mailboxes/{a_id}/messages", headers=mbx_headers(b_tok)).status_code == 404
    assert client.get(f"/api/mailboxes/{b_id}/messages/{a_msg['id']}", headers=mbx_headers(b_tok)).status_code == 404
    assert client.patch(f"/api/mailboxes/{b_id}/messages/{a_msg['id']}", json={"is_read": True},
                        headers=mbx_headers(b_tok)).status_code == 404
    assert client.delete(f"/api/mailboxes/{b_id}/messages/{a_msg['id']}", headers=mbx_headers(b_tok)).status_code == 404
    r = client.post(f"/api/mailboxes/{b_id}/messages/bulk", json={"ids": [a_msg["id"]], "action": "delete"},
                    headers=mbx_headers(b_tok))
    assert r.json()["updated"] == 0
    assert len(_first_message(client, a_id, a_tok)) == 1
    assert _first_message(client, b_id, b_tok) == []


def test_open_by_token_and_rotation(client):
    mid, token, _ = make_mailbox(client)
    assert client.post("/api/mailboxes/open", json={"token": token}).json()["mailbox"]["id"] == mid
    new = client.post(f"/api/mailboxes/{mid}/rotate-token", headers=mbx_headers(token)).json()["token"]
    assert client.get(f"/api/mailboxes/{mid}", headers=mbx_headers(token)).status_code == 404
    assert client.get(f"/api/mailboxes/{mid}", headers=mbx_headers(new)).status_code == 200


def test_expired_mailbox_is_inaccessible_and_rejects_mail(client, db):
    from datetime import timedelta

    from app.db import utcnow
    from app.models import Mailbox

    mid, token, address = make_mailbox(client)
    mb = db.get(Mailbox, __import__("uuid").UUID(mid))
    mb.expires_at = utcnow() - timedelta(minutes=1)
    db.commit()
    assert client.get(f"/api/mailboxes/{mid}", headers=mbx_headers(token)).status_code == 404
    res = deliver(build_email(address), [address])
    assert res.accepted == [] and res.rejected[address] == "expired"


def test_unknown_and_foreign_domain_recipients_rejected(client):
    res = deliver(build_email("nobody@test.example"), ["nobody@test.example", "x@gmail.com"])
    assert res.accepted == []
    assert res.rejected == {"nobody@test.example": "unknown", "x@gmail.com": "domain"}


def test_plus_addressing_routes_to_base_mailbox(client):
    mid, token, address = make_mailbox(client, local_part="qa-team")
    deliver(build_email("qa-team+signup42@test.example"), ["qa-team+signup42@test.example"])
    assert len(_first_message(client, mid, token)) == 1


def test_custom_local_part_validation(client):
    assert client.post("/api/mailboxes", json={"local_part": "postmaster"}).status_code == 422
    assert client.post("/api/mailboxes", json={"local_part": "../x"}).status_code == 422
    assert client.post("/api/mailboxes", json={"domain": "gmail.com"}).status_code == 422
    make_mailbox(client, local_part="taken.name")
    assert client.post("/api/mailboxes", json={"local_part": "taken.name"}).status_code == 409


def test_accounts_saved_mailboxes_and_claim(client):
    ses = register(client)
    # claim a temporary mailbox → requires both session and mailbox token
    mid, token, _ = make_mailbox(client)
    assert client.post(f"/api/mailboxes/{mid}/claim", headers=bearer(ses)).status_code == 404
    r = client.post(f"/api/mailboxes/{mid}/claim", headers={**bearer(ses), **mbx_headers(token)})
    assert r.status_code == 200 and r.json()["is_saved"] and r.json()["expires_at"] is None
    # now the session alone grants access
    assert client.get(f"/api/mailboxes/{mid}", headers=bearer(ses)).status_code == 200
    mine = client.get("/api/me/mailboxes", headers=bearer(ses)).json()["items"]
    assert [m["id"] for m in mine] == [mid]
    # another user cannot see it
    other = register(client, email="other@example.org")
    assert client.get(f"/api/mailboxes/{mid}", headers=bearer(other)).status_code == 404


def test_login_logout_and_bad_credentials(client):
    register(client)
    assert client.post("/api/auth/login", json={"email": "qa@example.org", "password": "wrong password!"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "nobody@example.org", "password": "whatever123"}).status_code == 401
    tok = client.post("/api/auth/login", json={"email": "QA@example.org", "password": "correct horse battery"}).json()["token"]
    assert client.get("/api/auth/me", headers=bearer(tok)).status_code == 200
    assert client.post("/api/auth/logout", headers=bearer(tok)).status_code == 204
    assert client.get("/api/auth/me", headers=bearer(tok)).status_code == 401
    assert client.post("/api/auth/register", json={"email": "qa@example.org", "password": "another long pw"}).status_code == 409
    assert client.post("/api/auth/register", json={"email": "short@example.org", "password": "short"}).status_code == 422


def test_password_is_hashed(client, db):
    from sqlalchemy import select

    from app.models import User

    register(client)
    u = db.scalar(select(User))
    assert u.password_hash.startswith("$argon2id$") and "correct horse" not in u.password_hash


def test_api_key_scopes(client):
    mid, token, address = make_mailbox(client)
    deliver(build_email(address, attachments=[("a.txt", "text/plain", b"hi")]), [address])
    r = client.post(f"/api/mailboxes/{mid}/api-keys", json={"name": "ci", "scopes": ["messages:read"]},
                    headers=mbx_headers(token))
    assert r.status_code == 201
    key = r.json()["key"]
    assert key.startswith("mak_")
    msgs = client.get(f"/api/mailboxes/{mid}/messages", headers=bearer(key))
    assert msgs.status_code == 200
    msg_id = msgs.json()["items"][0]["id"]
    # read-only key cannot modify or read attachments or manage the mailbox
    assert client.patch(f"/api/mailboxes/{mid}/messages/{msg_id}", json={"is_read": True}, headers=bearer(key)).status_code == 404
    assert client.get(f"/api/mailboxes/{mid}/attachments", headers=bearer(key)).status_code == 404
    assert client.delete(f"/api/mailboxes/{mid}", headers=bearer(key)).status_code == 404
    # a key bound to one mailbox cannot read another
    other_id, _, _ = make_mailbox(client)
    assert client.get(f"/api/mailboxes/{other_id}/messages", headers=bearer(key)).status_code == 404
    # revoke
    kid = r.json()["api_key"]["id"]
    assert client.delete(f"/api/api-keys/{kid}", headers=mbx_headers(token)).status_code == 204
    assert client.get(f"/api/mailboxes/{mid}/messages", headers=bearer(key)).status_code == 401


def test_user_api_key_can_create_saved_mailboxes(client):
    ses = register(client)
    r = client.post("/api/api-keys", json={"name": "ci", "scopes": ["mailboxes:create", "messages:read"]}, headers=bearer(ses))
    key = r.json()["key"]
    created = client.post("/api/mailboxes", json={"label": "from CI"}, headers=bearer(key))
    assert created.status_code == 201 and created.json()["mailbox"]["is_saved"]
    mid = created.json()["mailbox"]["id"]
    assert client.get(f"/api/mailboxes/{mid}/messages", headers=bearer(key)).status_code == 200
    ro = client.post("/api/api-keys", json={"name": "ro", "scopes": ["messages:read"]}, headers=bearer(ses)).json()["key"]
    assert client.post("/api/mailboxes", json={}, headers=bearer(ro)).status_code == 403


def test_admin_endpoints_require_admin(client):
    assert client.get("/api/admin/overview").status_code == 401
    ses = register(client)
    assert client.get("/api/admin/overview", headers=bearer(ses)).status_code == 403


def test_rate_limit_mailbox_creation(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "rl_mailbox_create_per_hour", 2)
    assert client.post("/api/mailboxes", json={}).status_code == 201
    assert client.post("/api/mailboxes", json={}).status_code == 201
    r = client.post("/api/mailboxes", json={})
    assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0
