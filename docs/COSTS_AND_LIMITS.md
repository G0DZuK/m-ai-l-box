# Hosting costs, provider limits and remaining production work

Prices change, so treat the figures below as orientation and check the providers' current pricing pages.

## Typical monthly cost (small team / light public use)

| Item | Option | Rough cost |
|---|---|---|
| Domain | dedicated receiving domain | about $10–15 / year |
| Server | 1 VPS, 2 vCPU / 4 GB, running the whole Compose stack | about $5–25 / month, depending on provider |
| Inbound mail | Cloudflare Email Routing | free routing; Workers Free plan, or Workers Paid (from about $5/month) if large messages hit Free-plan CPU limits |
| | Built-in SMTP on your VPS | $0 extra (needs inbound port 25) |
| | Mailgun | inbound routing depends on the plan; check current plan features |
| Object storage | bundled MinIO on the VPS disk / S3 / R2 / B2 | MinIO: disk only. Managed object storage is usually a few cents per GB per month, plus request and egress charges that vary by provider |
| Database | bundled PostgreSQL / managed PostgreSQL | $0 extra / about $15+ per month managed |
| Malware scanning | ClamAV container | $0, but needs about 1–1.5 GB of extra RAM for signatures |

Storage drives cost. Every saved account may use up to `USER_QUOTA_BYTES` (1 GB by default). Temporary mailboxes are capped by `TEMP_MAILBOX_QUOTA_BYTES` (100 MB) and expire after `TEMP_MAILBOX_TTL_HOURS` (24 h). Size disks and buckets for *active users × quota*, not for unlimited storage. **No unlimited storage is offered.**

## Limits

| Limit | Default | Notes |
|---|---|---|
| Incoming message | 25 MB (`MAX_MESSAGE_BYTES`) | Cloudflare Email Routing rejects messages over **25 MiB**. Mailgun's cap is commonly reported as 25 MB; confirm it for your plan. Your SMTP receiver enforces the configured value. |
| Largest attachment in a 25 MB message | about 18 MB | Base64 transfer encoding inflates binary data by about 33% (plus MIME headers and line breaks). |
| Personal upload | 25 MB (`MAX_UPLOAD_BYTES`) | The reverse proxy body limit (80 MB in `deploy/Caddyfile`) must stay above it. |
| Account quota | 1 GB (`USER_QUOTA_BYTES`) | Counts saved mailboxes' messages (raw size, which includes attachments) plus personal files. Enforced on the backend for uploads, save-to-files and inbound mail to saved mailboxes (`552 Mailbox full` / rejected). |
| Temporary mailbox | 200 messages / 100 MB | `TEMP_MAILBOX_MAX_MESSAGES`, `TEMP_MAILBOX_QUOTA_BYTES` |
| Raw source view | 2 MB | The full original is always available as an `.eml` download. |
| Inline images rendered in HTML | 2 MB each | Larger inline images remain downloadable as attachments. |
| `wait` long-poll | 120 s (`WAIT_MAX_SECONDS`) | |

## What works now vs. what needs your setup

**Working in this repository (verified by the automated tests and a local SMTP run):** mailbox creation and isolation, real SMTP reception, MIME parsing, attachments and inline images, de-duplication, retries and failure states, signed downloads, safe HTML, OTP and link extraction, search, trash and retention, accounts, quotas, personal files, scoped API keys, the wait API, admin metadata and abuse controls, demo mode.

**Needs external configuration before public use:**

1. A domain, DNS records and one inbound path (Cloudflare Worker, port 25 SMTP, or Mailgun). See [DEPLOYMENT.md](DEPLOYMENT.md).
2. HTTPS on the server (Caddy handles it automatically once DNS points at the server).
3. Real secrets in `.env`, and an admin account created with the CLI.
4. Backups for PostgreSQL and the bucket.

**Not yet verified in this environment:**

- PostgreSQL, Redis, MinIO and Celery ran in Docker only by design. The test suite uses SQLite, local storage and inline processing because Docker wasn't available on the build machine. Run `docker compose up --build`, send a test message, and check Admin → Overview before relying on it.
- The Cloudflare Worker and the Mailgun endpoint were verified with signed test requests, not with live provider traffic. Send one real external message per provider after setup.

**Recommended before a large public launch:**

- Terms of use and an abuse contact; a CAPTCHA or proof-of-work on mailbox creation if bots become a problem (this app does not include one).
- Monitoring and alerting on `/api/health`, on failed deliveries and on disk usage; centralised logs.
- Account e-mail verification and password reset (accounts currently use e-mail + password without verification, which is fine for a private deployment).
- A `pg_trgm` index for search at large scale, and an S3 lifecycle rule as a backstop for orphaned objects.
- Outbound e-mail (replies or forwarding) is intentionally out of scope.
