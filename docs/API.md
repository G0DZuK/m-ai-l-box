# M-Ai-L Box REST API

Base path: `/api`. All request and response bodies are JSON unless noted. Interactive OpenAPI docs are served at `/api/docs` (Swagger UI) and `/api/openapi.json`.

## Credentials

There are three kinds of credentials, each a random opaque string with a recognisable prefix. They are only ever sent in **headers**, never in URLs.

| Credential | Prefix | Header | Grants |
|---|---|---|---|
| Mailbox access token | `mbx_` | `X-Mailbox-Token: mbx_…` | Full access to **one** mailbox |
| Account session | `ses_` | `Authorization: Bearer ses_…` | The signed-in user's saved mailboxes, files, API keys |
| API key | `mak_` | `Authorization: Bearer mak_…` | Only the scopes it was created with |

Knowing an e-mail address grants nothing. Requests for a mailbox the caller cannot access return **404** (not 403) so mailbox existence is not revealed.

API key scopes: `mailboxes:create`, `messages:read`, `messages:write`, `attachments:read`. A key is bound either to a user (all of that user's saved mailboxes) or to a single mailbox.

## Errors and limits

Errors use `{"detail": "human readable message"}` (validation errors: FastAPI's standard 422 shape).
Rate limited responses return **429** with a `Retry-After` header (seconds).
Common statuses: 400 bad input, 401 missing/invalid credential, 403 forbidden (e.g. admin only, infected file), 404 not found / no access, 408 wait timed out, 409 conflict, 413 too large, 422 validation, 429 rate limited, 507 quota exceeded.

## Objects

```jsonc
// Mailbox
{
  "id": "uuid", "address": "k7m2x9p4qa@inbox.example.com", "local_part": "k7m2x9p4qa", "domain": "inbox.example.com",
  "label": "Signup tests" | null,
  "created_at": "2026-10-14T10:00:00Z",
  "expires_at": "2026-10-15T10:00:00Z" | null,   // null = saved to an account (no expiry)
  "is_saved": false, "is_demo": false, "disabled": false,
  "message_count": 3, "unread_count": 1, "storage_bytes": 52311,
  "token_hint": "mbx_Ab3d…"                        // never the full token
}

// Address  (used in from/to/cc/reply_to)
{ "name": "Alice" | null, "address": "alice@example.org" }

// MessageSummary
{
  "id": "uuid", "mailbox_id": "uuid",
  "subject": "Your code" , "from": Address | null, "to": [Address],
  "snippet": "first ~160 chars of the plain text",
  "received_at": "…Z",          // when M-Ai-L Box received it (server clock)
  "sent_at": "…Z" | null,       // sender-provided Date: header (untrusted)
  "is_read": false, "is_starred": false, "in_trash": false, "deleted_at": null,
  "has_attachments": true, "attachment_count": 1, "size_bytes": 20480,
  "has_otp": true, "is_demo": false
}

// MessageDetail = MessageSummary + 
{
  "cc": [Address], "reply_to": [Address],
  "envelope_from": "bounce@example.org" | null, "envelope_to": ["k7m2x9p4qa@inbox.example.com"],
  "message_id_header": "<abc@example.org>" | null,
  "text_body": "plain text (derived from HTML when no text part)",
  "has_html": true,
  "headers": [{"name": "Received", "value": "…"}],
  "attachments": [Attachment],
  "otp_codes": [{"code": "482913", "context": "…your verification code is 482913…"}],
  "links": [{"url": "https://…", "text": "Confirm e-mail" | null, "source": "html" | "text"}],
  "delivery_source": "smtp" | "cloudflare" | "mailgun" | "demo"
}

// Attachment
{
  "id": "uuid", "message_id": "uuid", "filename": "invoice.pdf",
  "content_type": "application/pdf", "size_bytes": 81234,
  "is_inline": false, "content_id": "<img1@x>" | null,
  "scan_status": "not_scanned" | "pending" | "clean" | "infected" | "error",
  "previewable": "image" | "pdf" | null,
  "created_at": "…Z"
}
// AttachmentListItem = Attachment + { "message_subject": "…", "message_from": Address | null, "received_at": "…Z" }

// DownloadLink — short lived (default 120 s), single object, safe to put in <a href> or <img src>
{ "url": "/api/download/eyJr…", "expires_in": 120 }

// User
{ "id": "uuid", "email": "me@example.org", "is_admin": false, "created_at": "…Z" }
// Usage
{ "used_bytes": 1048576, "quota_bytes": 1073741824, "messages_bytes": 524288, "files_bytes": 524288 }

// StoredFile (personal storage)
{ "id": "uuid", "filename": "notes.pdf", "content_type": "application/pdf", "size_bytes": 1234,
  "created_at": "…Z", "scan_status": "not_scanned", "source": "upload" | "attachment", "previewable": "pdf" | "image" | null }

// ApiKey
{ "id": "uuid", "name": "CI", "prefix": "mak_Q2x9", "scopes": ["messages:read"], "mailbox_id": "uuid" | null,
  "created_at": "…Z", "last_used_at": "…Z" | null }
```

Lists return `{"items": [...], "next_cursor": "opaque" | null}`. Pass `cursor=<next_cursor>` to get the next page.

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{"status":"ok"|"degraded","checks":{"database":"ok","storage":"ok","redis":"ok"|"unavailable"}}` |
| GET | `/api/config` | Public service settings (below) |

```jsonc
// GET /api/config
{
  "app_name": "M-Ai-L Box", "tagline": "Built for developers. Ready for testers.",
  "domains": ["inbox.example.com"], "default_domain": "inbox.example.com",
  "demo_mode": false, "inbound_adapters": ["smtp"],
  "accounts_enabled": true, "registration_open": true,
  "custom_local_part_allowed": true,
  "temp_mailbox_ttl_hours": 24, "trash_retention_days": 7, "saved_message_retention_days": 0,   // 0 = keep until deleted
  "temp_mailbox_max_messages": 200,
  "max_message_bytes": 26214400, "max_upload_bytes": 26214400, "user_quota_bytes": 1073741824,
  "scanner": "none" | "clamav",
  "wait_max_seconds": 120
}
```

## Mailboxes

| Method | Path | Auth | Body / query | Response |
|---|---|---|---|---|
| POST | `/api/mailboxes` | none (temporary) · session or key with `mailboxes:create` (saved) | `{"domain"?: str, "local_part"?: str, "label"?: str, "save"?: bool}` | 201 `{"mailbox": Mailbox, "token": "mbx_…"}` |
| POST | `/api/mailboxes/open` | none | `{"token": "mbx_…"}` | `{"mailbox": Mailbox}` — look up a mailbox by its token (returning from another device) |
| GET | `/api/mailboxes/{id}` | mailbox | | `Mailbox` |
| PATCH | `/api/mailboxes/{id}` | mailbox | `{"label": str | null}` | `Mailbox` |
| DELETE | `/api/mailboxes/{id}` | mailbox | | 204 — deletes the mailbox, its messages, attachments and originals |
| POST | `/api/mailboxes/{id}/claim` | session **and** `X-Mailbox-Token` | | `Mailbox` — saves it to the account (removes expiry, counts toward quota) |
| POST | `/api/mailboxes/{id}/release` | session | | `Mailbox` — un-saves; expiry restarts |
| POST | `/api/mailboxes/{id}/rotate-token` | mailbox | | `{"mailbox": Mailbox, "token": "mbx_…"}` — the old token stops working |
| GET | `/api/me/mailboxes` | session | | `{"items": [Mailbox]}` |
| GET | `/api/mailboxes/{id}/events` | mailbox | | `text/event-stream` (see below) |

"mailbox" auth means any of: that mailbox's `X-Mailbox-Token`, the owning user's session, or an API key bound to it / its owner with the right scope.

`local_part` (optional): 3–40 chars `a-z 0-9 . _ -`, must start with a letter or digit; reserved names (postmaster, abuse, admin, …) are refused. Omit it to get a random address. Returns 409 if taken.

## Messages

| Method | Path | Notes |
|---|---|---|
| GET | `/api/mailboxes/{id}/messages` | Query: `folder=inbox|starred|trash|all` (default inbox), `q` (sender, recipients, subject, body), `from`, `to`, `subject`, `after`, `before` (ISO date/time, compares `received_at`), `unread=true`, `has_attachments=true`, `limit` (1–100, default 50), `cursor`. Newest first. → `{"items":[MessageSummary],"next_cursor":…}` |
| GET | `/api/mailboxes/{id}/messages/{mid}` | → `MessageDetail`. Does **not** mark as read. |
| GET | `/api/mailboxes/{id}/messages/{mid}/html?remote_images=false` | → `{"html": "<!doctype html>…", "blocked_remote_images": 3, "remote_images_loaded": false}`. Sanitised document with its own CSP; render it only inside `<iframe sandbox srcdoc>`. `null` html if the message has no HTML part. |
| GET | `/api/mailboxes/{id}/messages/{mid}/raw` | → `{"raw": "original source as text", "truncated": false, "size_bytes": 20480}` (view is capped at 2 MB; download the .eml for the full file) |
| POST | `/api/mailboxes/{id}/messages/{mid}/download-link` | → `DownloadLink` for the original `.eml` |
| PATCH | `/api/mailboxes/{id}/messages/{mid}` | `{"is_read"?: bool, "is_starred"?: bool}` → `MessageSummary` |
| POST | `/api/mailboxes/{id}/messages/{mid}/trash` | → `MessageSummary` (moves to Trash) |
| POST | `/api/mailboxes/{id}/messages/{mid}/restore` | → `MessageSummary` |
| DELETE | `/api/mailboxes/{id}/messages/{mid}` | 204 — permanent: deletes the message, its attachments and (if unshared) the original |
| POST | `/api/mailboxes/{id}/messages/bulk` | `{"ids":[uuid], "action":"read"|"unread"|"star"|"unstar"|"trash"|"restore"|"delete"}` → `{"updated": n}` |
| POST | `/api/mailboxes/{id}/trash/empty` | → `{"deleted": n}` |
| GET | `/api/mailboxes/{id}/wait` | Long-poll for a matching message. Query: `since` (ISO time; only messages received at/after it), `subject` (substring), `from` (substring), `to` (substring of a recipient), `body` (substring), `timeout` (seconds, 1–`wait_max_seconds`, default 30). → `MessageDetail` of the oldest match, or **408** `{"detail":"No matching message arrived within 30s"}` |

### Events (server-sent)

`GET /api/mailboxes/{id}/events` with the usual auth headers (use `fetch()` streaming — `EventSource` cannot send headers).

```
event: state
data: {"message_count": 3, "unread_count": 1}

event: message
data: {"id": "uuid", "received_at": "…Z", "subject": "…"}

event: ping
data: {}
```
`state` is sent on connect and whenever counts change; `ping` every 15 s.

## Attachments

| Method | Path | Notes |
|---|---|---|
| GET | `/api/mailboxes/{id}/attachments` | Attachments of non-trashed messages. Query `q` (filename / sender / subject), `sort=received|name|size|type`, `order=desc|asc`, `include_inline=false`, `limit`, `cursor` → `{"items":[AttachmentListItem],"next_cursor":…}` |
| POST | `/api/mailboxes/{id}/attachments/{aid}/download-link?disposition=attachment|inline` | → `DownloadLink`. `inline` only for `previewable` types; infected files → 403. |
| POST | `/api/mailboxes/{id}/attachments/{aid}/save-to-files` | session; copies into personal storage (counts toward quota) → `StoredFile` |

`GET /api/download/{token}` streams the object. Tokens expire after ~2 minutes and are bound to one object. Responses carry `Content-Disposition`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'…` and `Referrer-Policy: no-referrer`.

## Accounts (optional)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register` | `{"email","password"}` (password ≥ 10 chars) → 201 `{"user": User, "token": "ses_…"}` |
| POST | `/api/auth/login` | `{"email","password"}` → `{"user": User, "token": "ses_…"}` |
| POST | `/api/auth/logout` | session → 204 |
| GET | `/api/auth/me` | session → `{"user": User, "usage": Usage}` |
| POST | `/api/auth/change-password` | `{"current_password","new_password"}` → 204 (other sessions are revoked) |
| DELETE | `/api/auth/me` | `{"password"}` → 204; deletes the account, its saved mailboxes, messages and files |

## Personal files (session)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/files` | `q`, `sort=created|name|size|type`, `order` → `{"items":[StoredFile],"next_cursor":null}` |
| POST | `/api/files` | `multipart/form-data` field `file` → 201 `StoredFile`; 413 over `max_upload_bytes`, 507 over quota |
| PATCH | `/api/files/{fid}` | `{"filename"}` → `StoredFile` |
| POST | `/api/files/{fid}/download-link?disposition=…` | → `DownloadLink` |
| DELETE | `/api/files/{fid}` | 204 |

## API keys

| Method | Path | Notes |
|---|---|---|
| GET | `/api/api-keys` | session → `{"items":[ApiKey]}` (user-bound and keys of owned mailboxes) |
| POST | `/api/api-keys` | session; `{"name", "scopes":[…], "mailbox_id"?: uuid}` → 201 `{"api_key": ApiKey, "key": "mak_…"}` (shown once) |
| GET | `/api/mailboxes/{id}/api-keys` | mailbox token → `{"items":[ApiKey]}` |
| POST | `/api/mailboxes/{id}/api-keys` | mailbox token; `{"name", "scopes"}` → 201 key bound to this mailbox (no account needed) |
| DELETE | `/api/api-keys/{kid}` | session (own keys) or mailbox token (keys of that mailbox) → 204 |

## Demo mode (only when `DEMO_MODE=true`)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/demo/mailbox` | → 201 `{"mailbox": Mailbox, "token": "mbx_…"}`: a mailbox pre-filled with **sample** messages (`is_demo: true`). Sample messages are not deliveries and prove nothing about real e-mail. |

## Inbound (machine-to-machine, not for browsers)

| Method | Path | Used by |
|---|---|---|
| POST | `/api/inbound/raw` | Cloudflare Email Worker (or any relay) — raw RFC 5322 body, HMAC-signed. See `docs/DEPLOYMENT.md`. |
| POST | `/api/inbound/mailgun/mime` | Mailgun Route `forward()` — form post with `body-mime`, Mailgun signature verified |

## Admin (session of a user with `is_admin`)

Admin endpoints never return message subjects, bodies, attachment names or full recipient addresses.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/overview` | counts, storage, deliveries by status (24 h), component health, effective limits/retention |
| GET | `/api/admin/deliveries?status=failed|queued|processing|processed|rejected&limit&cursor` | `{"items":[{"id","source","status","attempts","last_error","size_bytes","recipient_domains":[…],"recipient_count","matched_count","received_at","processed_at"}],"next_cursor"}` |
| POST | `/api/admin/deliveries/{did}/retry` | re-queues a failed delivery |
| GET | `/api/admin/users?q=` | `{"items":[{"id","email","is_admin","disabled","created_at","quota_bytes","used_bytes","mailbox_count"}]}` |
| PATCH | `/api/admin/users/{uid}` | `{"quota_bytes"?, "disabled"?, "is_admin"?}` |
| GET | `/api/admin/blocks` | `{"items":[{"id","kind":"sender"|"sender_domain"|"ip"|"mailbox","value","reason","created_at","expires_at"}]}` |
| POST | `/api/admin/blocks` | `{"kind","value","reason"?,"expires_at"?}` |
| DELETE | `/api/admin/blocks/{bid}` | 204 |
| POST | `/api/admin/mailboxes/disable` | `{"address", "disabled": true|false}` → `{"address","disabled"}` (no content returned) |
| POST | `/api/admin/cleanup` | runs retention cleanup now → counts |

See `docs/QA_AUTOMATION.md` for end-to-end automation examples.
