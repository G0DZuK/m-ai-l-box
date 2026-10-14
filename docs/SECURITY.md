# Security model and data handling

## Access control

- **Every** mailbox, message, attachment, file and API-key request is authorised on the server (`app/deps.py: authorize_mailbox`). Messages and attachments are always looked up *within* the authorised mailbox, so IDs from another mailbox return 404.
- A mailbox is readable by holders of its **access token**, by its **owning account** (saved mailboxes), or by an **API key** bound to it or to its owner *and* carrying the needed scope. Knowing the address grants nothing. Unauthorised requests get **404** so mailbox existence isn't revealed.
- Tokens are 256-bit random values (`secrets.token_urlsafe(32)`) with type prefixes. Only an HMAC-SHA256 digest (keyed with `SECRET_KEY`) is stored, so a database leak does not reveal usable tokens.
- Passwords are hashed with **Argon2id** (argon2-cffi). Login is rate limited per IP and per account; unknown e-mails take comparable time. Changing the password revokes the account's other sessions.
- The admin role is granted only by the operator CLI (`python -m app.cli create-admin`). Admin endpoints return counts and metadata, never message subjects, bodies, attachment names or full recipient addresses.

## Tokens stay out of logs and referrers

- Credentials travel only in headers (`X-Mailbox-Token`, `Authorization`), never in URLs. Live updates use `fetch()` streaming, because `EventSource` would force the token into the query string.
- `Referrer-Policy: no-referrer` is set on all responses and inside rendered e-mail; links get `rel="noopener noreferrer nofollow"`.
- Application logs pass through a redacting filter (`mbx_…`, `ses_…`, `mak_…`, `Bearer …`, `/api/download/…`, `password=`, `token=`, `signature=`). The Caddy config strips auth headers and download paths from access logs. **Message contents are never logged**; the pipeline logs only IDs, sizes and error class names.

## Untrusted e-mail

- **HTML**: sanitised with nh3/ammonia using an allow-list. Removed: scripts, event handlers, `javascript:`/`data:` URLs, forms and inputs, iframes, objects and embeds, SVG and MathML, `<meta>`, `<link>`, `@import`. Remote images, CSS `url()` and `background=` are stripped **until the user clicks "Load remote images"**. The result is a standalone document with its own CSP (`default-src 'none'`, no script source, `form-action 'none'`, images from `data:` only unless opted in). It is rendered in `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox">`, an opaque origin with no script execution.
- **Headers and bodies**: parsed with defensive fallbacks. Header values are decoded, truncated, and rendered as text by React (escaped).
- **Filenames**: path components, control characters, bidi overrides and reserved characters and device names are stripped; length is capped. Filenames are never used as storage paths. Object keys come from UUIDs and are validated against traversal.
- **Downloads**: only through `/api/download/<signed token>`. The token is HMAC-signed, expires in about 2 minutes and names exactly one object. Responses use `Content-Disposition: attachment`, `application/octet-stream`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`. **Inline previews** are offered only when the *bytes* (not the claimed type) are PNG, JPEG, GIF, WebP or PDF. SVG and HTML attachments are never previewed.
- **Size and abuse limits**: message size (SMTP `SIZE` and webhook body caps), recipients per message, per-mailbox inbound rate, per-IP SMTP rate, mailbox-creation rate, API rate per credential, upload size and rate, and per-account quota.

## Malware scanning

`SCANNER=none` (default): files are marked **Not scanned** in the UI. `SCANNER=clamav`: each attachment and upload is streamed to clamd (`INSTREAM`) before storage. Results are `clean`, `infected` (stored for audit, download blocked) or `error` (the scanner was unreachable; the file stays downloadable with a warning).

Limitations: signature scanning misses new or targeted malware, encrypted archives and very large files (ClamAV has its own stream size limit, `StreamMaxLength`). **No scanner makes a file safe to open.** Testers should treat all attachments as untrusted.

## Deletion behaviour

| Action | What is deleted |
|---|---|
| Move to Trash | Nothing yet. The message is hidden from the Inbox and **permanently deleted after `TRASH_RETENTION_DAYS`** (7 by default). |
| Delete forever / Empty trash | The message row, its attachments (database rows and stored files) and the original `.eml`, unless the same original is shared with a copy in another mailbox, in which case it is deleted with the last copy. |
| Delete mailbox | The mailbox, all its messages, attachments and originals, and its API keys. |
| Temporary mailbox expiry | Same as deleting the mailbox, done by the hourly cleanup after `expires_at`. |
| Saved mailboxes | Kept until the user deletes them, or after `SAVED_MESSAGE_RETENTION_DAYS` if the operator sets it above 0. |
| "Save to my files" | A **copy** of the attachment in personal storage; it survives message deletion and counts toward the quota. |
| Delete account | Saved mailboxes, their messages and attachments, personal files, sessions and API keys. |
| Delivery log | Metadata rows are kept `DELIVERY_LOG_RETENTION_DAYS` (14). Originals of failed deliveries are kept for retry until then. |

Deleted objects are removed from the bucket immediately. If storage is temporarily unavailable, the database rows are still removed and the orphaned object is logged; schedule a periodic bucket lifecycle rule as a backstop. Backups made before a deletion still contain the data until they rotate.

## Secrets

All secrets come from environment variables (`SECRET_KEY`, `INBOUND_WEBHOOK_SECRET`, `MAILGUN_WEBHOOK_SIGNING_KEY`, `S3_*`, `DATABASE_URL`). In production the app refuses to start with the development `SECRET_KEY`. Rotating `SECRET_KEY` invalidates all tokens, sessions, API keys and download links.
