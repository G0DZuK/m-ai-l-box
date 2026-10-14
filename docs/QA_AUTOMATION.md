# QA automation guide

Everything the UI does is available over the REST API ([API.md](API.md); interactive docs at `/api/docs`).

## Pattern: one mailbox per test

1. `POST /api/mailboxes` → `{mailbox: {id, address}, token}`.
2. Record `since = now()` (UTC, ISO 8601).
3. Make the application under test send to `mailbox.address`.
4. `GET /api/mailboxes/{id}/wait?subject=…&since=…&timeout=60`. This returns the **oldest** matching message received at or after `since`, or **408** if none arrives in time.
5. Assert on `otp_codes`, `links`, `attachments`, `text_body`, headers and so on.
6. `DELETE /api/mailboxes/{id}` to clean up (otherwise the mailbox expires on its own).

`wait` filters: `subject`, `from`, `to`, `body` (case-insensitive substrings), `since`; `timeout` is capped at `WAIT_MAX_SECONDS` (120 by default). Set your HTTP client's timeout a few seconds above it.

## Credentials for CI

| Option | When |
|---|---|
| Mailbox token (`X-Mailbox-Token: mbx_…`) | Simplest: per-test temporary mailboxes. Full control of that one mailbox. |
| **Mailbox-bound API key** (`Authorization: Bearer mak_…`) | A long-lived saved mailbox shared by a suite. Create it with `POST /api/mailboxes/{id}/api-keys` and `scopes: ["messages:read","attachments:read"]`. It is revocable and cannot delete the mailbox. |
| **User API key** with `mailboxes:create` | The suite creates its own saved mailboxes under your account (`POST /api/mailboxes` with the key). |

Keep keys in your CI secret store. Never put them in URLs. Rate limits are per credential (`RL_API_PER_MINUTE`, 300/min by default); a `429` response carries `Retry-After`.

## Timestamps for delivery testing

- `received_at`: when M-Ai-L Box accepted the message (server clock, UTC). Use it for latency checks.
- `sent_at`: the sender's `Date:` header. **It is set by the sender and is untrusted**; it can be wrong, missing or in another time zone (normalised to UTC).

## Codes and links

- `otp_codes`: 4–8 digit codes (also `123-456` and `123 456` forms) and 6–8 character alphanumeric codes found near words such as *code, OTP, verification, PIN, passcode, one-time, login*. The message itself is never modified.
- `links`: `http(s)` and `mailto` URLs from HTML anchors (with their link text) and from plain text. **They are never opened automatically**, so clicking or fetching one is a deliberate step in your test.

## Examples

- [`examples/test_signup_email.py`](../examples/test_signup_email.py): pytest + httpx
- [`examples/signup.spec.ts`](../examples/signup.spec.ts): Playwright
- [`examples/curl.sh`](../examples/curl.sh): curl + jq

### Python snippet

```python
import httpx, datetime as dt
api = httpx.Client(base_url="https://app.my-qa-inbox.com", timeout=130)
mb = api.post("/api/mailboxes", json={"label": "checkout test"}).json()
api.headers["X-Mailbox-Token"] = mb["token"]
since = dt.datetime.now(dt.timezone.utc).isoformat()
# … trigger the e-mail …
msg = api.get(f"/api/mailboxes/{mb['mailbox']['id']}/wait",
              params={"subject": "order confirmation", "since": since, "timeout": 90})
msg.raise_for_status()
code = msg.json()["otp_codes"][0]["code"]
```

### Downloading an attachment

```python
att = msg.json()["attachments"][0]
link = api.post(f"/api/mailboxes/{mbid}/attachments/{att['id']}/download-link").json()
pdf_bytes = api.get(link["url"]).content          # link valid ~2 minutes, no auth header needed
```

### Sending a local test message

`python scripts/send_test_email.py <address> --html --attach file.pdf` performs a real SMTP transaction against `localhost:2525`.
