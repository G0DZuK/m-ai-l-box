# Architecture

```
                 ┌──────────────────────── inbound adapters (replaceable) ────────────────────────┐
 sender MTA ──►  │ smtp:       aiosmtpd receiver (port 25 / 2525) — validates RCPT, size, blocks │
 sender MTA ──►  │ cloudflare: Email Routing ─► Email Worker ─► POST /api/inbound/raw (HMAC)      │
 sender MTA ──►  │ mailgun:    Routes forward() ─► POST /api/inbound/mailgun/mime (Mailgun sig)  │
                 └───────────────────────────────┬─────────────────────────────────────────────────┘
                                                 ▼
                         app.mail.ingest.accept_delivery()
                         size & abuse checks · route recipients · raw .eml → object storage
                         Delivery row (queued) · enqueue
                                                 ▼   Redis (Celery broker)
                         Celery worker: process_delivery()  (retries 15 s→240 s, then "failed")
                         MIME parse (stdlib email) · dedupe · OTP/link extraction
                         attachments → object storage (+ optional ClamAV) · Message rows
                                                 ▼
   React SPA ◄── REST + SSE ──► FastAPI ──► PostgreSQL (metadata, text/HTML bodies)
   (same origin)                    └────► S3/MinIO (private: originals, attachments, user files)
                         Celery beat: hourly retention cleanup, 5-min re-queue of stuck deliveries
```

## Components

| Piece | Responsibility |
|---|---|
| **FastAPI app** (`backend/app/main.py`) | REST API under `/api`, OpenAPI at `/api/docs`, serves the built SPA, security headers. Business logic, authN/authZ, storage access and e-mail processing all live in Python. |
| **Inbound adapters** (`app/inbound/smtp_server.py`, `app/routers/inbound.py`) | Each adapter only authenticates the transport and passes `(raw bytes, envelope recipients, envelope sender)` to `accept_delivery()`. Adding a provider (for example Amazon SES via SNS) means one more small adapter; the pipeline stays the same. |
| **Pipeline** (`app/mail/ingest.py`) | Two phases. *Accept* is fast and synchronous: it rejects unknown recipients at the edge, persists the raw original, then enqueues. *Process* runs asynchronously and retries. A delivery is saved durably before it is acknowledged, so a crashed worker cannot lose mail; a 5-minute sweep re-queues anything stuck. |
| **Parser** (`app/mail/parser.py`) | `email.parser.BytesParser(policy=default)`, with defensive fallbacks for broken headers and charsets, RFC 2047/2231 decoding, `message/rfc822` kept as a single attachment, and filename sanitisation. |
| **HTML rendering** (`app/mail/sanitize.py`) | HTML is stored as received and sanitised at view time with nh3 (ammonia), so sanitiser improvements apply retroactively. Output is a standalone document with its own CSP, rendered in a sandboxed iframe. |
| **Object storage** (`app/storage.py`) | S3 API (MinIO locally; S3, R2, B2 or similar in production) or a local folder for tests and lite mode. Keys are generated from UUIDs, never from filenames. |
| **Celery** (`app/tasks.py`) | `process_delivery` (acks late, 5 retries with backoff), `cleanup` (hourly), `requeue_stale` (every 5 min). |
| **SPA** (`frontend/`) | React, TypeScript, Vite and Tailwind. Talks only to the documented REST endpoints. Live updates use fetch-streamed SSE, falling back to polling. |

## Data model (PostgreSQL)

`users` · `user_sessions` · `mailboxes` · `deliveries` · `messages` · `attachments` · `stored_files` · `api_keys` · `abuse_blocks`. See `backend/app/models.py` and `backend/alembic/versions/0001_initial_schema.py`.

- **deliveries** holds one row per inbound transmission: metadata only (status, attempts, error class, size, recipient *domains*). Admins use it to diagnose failures without seeing content.
- **messages** holds headers as JSON, text and HTML bodies, extracted OTPs and links, and `received_at` (server clock) kept separate from `sent_at` (the sender's `Date:` header). `UNIQUE(mailbox_id, dedupe_key)` provides idempotency.
- **attachments / stored_files** hold the object key, a sniffed preview kind (`image` or `pdf`, detected from the file's magic bytes rather than the claimed type) and the scan status.

## Key decisions

- **Inbound provider.** Two real options are built in, with a third available:
  1. **Self-hosted SMTP** (aiosmtpd). No third party; works locally out of the box. Production needs a host with inbound TCP 25 and an MX record pointing at it.
  2. **Cloudflare Email Routing + Email Worker** (recommended for public deployment). Free routing, a documented **25 MiB** inbound message limit, no port 25 on your server, and HMAC-signed relay to `/api/inbound/raw`.
  3. **Mailgun Routes** (optional). HMAC-SHA256 signed posts with the account's webhook signing key; retries for up to 8 hours on non-2xx; `406` means "do not retry". Inbound routing availability depends on your Mailgun plan.
- **Duplicate handling.** The dedupe key is `sha256(normalised Message-ID)`, or `sha256(raw bytes)` when there is no Message-ID. Provider retries and multi-path deliveries collapse into one message per mailbox. Two different sends that reuse one Message-ID are also treated as one; real mail systems generate a unique ID per send.
- **Unknown or expired recipients** are refused at the edge (`550 5.1.1` over SMTP, `404` to the Worker, which rejects the message, `406` to Mailgun) when `UNKNOWN_RECIPIENT_POLICY=reject`, the default. With `discard` they are accepted and silently dropped. Nothing is stored either way.
- **Credentials** are opaque random tokens with a type prefix (`mbx_`, `ses_`, `mak_`). Only a keyed SHA-256 of each is stored. They travel in headers only; download links are separate short-lived signed tokens scoped to one object.
- **Search** uses portable case-insensitive substring matching over a lower-cased haystack column. That is fine for mailbox-sized data. For very large deployments, add a PostgreSQL `pg_trgm` GIN index on `messages.search_text`.
