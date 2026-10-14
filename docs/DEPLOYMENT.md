# Production deployment

This guide puts M-Ai-L Box on your own domain so that anyone can create a mailbox and mail from the public internet arrives. Docker Compose alone does not do that: **you also need DNS (MX records) and a reachable inbound service.**

> Use a **dedicated domain** for receiving, for example `my-qa-inbox.com`, rather than your company's main domain. The setup below sends *all* mail for the receiving domain to M-Ai-L Box (catch-all), and changing the MX records of a domain that already receives mail would break its existing mailboxes.

## 1. Choose an inbound path

| | **A. Cloudflare Email Routing + Worker** (recommended) | **B. Built-in SMTP receiver** | **C. Mailgun Routes** |
|---|---|---|---|
| Needs | Domain on Cloudflare DNS, Workers | Server with **inbound TCP 25** open | Mailgun account with inbound routing |
| Message size | 25 MiB (Cloudflare limit) | `MAX_MESSAGE_BYTES` | 25 MB is commonly reported; confirm for your plan |
| Webhook security | HMAC-SHA256 shared secret (this repo's Worker) | n/a (SMTP; optional STARTTLS) | HMAC-SHA256 with the webhook signing key |
| Cost | Email Routing free; Workers Free or Paid plan | your server only | depends on plan |
| `INBOUND_ADAPTERS` | `["cloudflare"]` | `["smtp"]` | `["mailgun"]` |

You can enable several at once, for example `["smtp","cloudflare"]`.

## 2. Server, HTTPS, database, worker, storage

1. **Server**: a small Linux VPS (2 vCPU / 2–4 GB RAM is plenty to start) with Docker Compose v2.24 or later.
2. **DNS for the web UI**: an `A`/`AAAA` record, for example `app.my-qa-inbox.com`, pointing at the server.
3. **Configuration** (`.env`, start from `.env.example`):
   ```dotenv
   ENVIRONMENT=production
   SECRET_KEY=<python -c "import secrets; print(secrets.token_urlsafe(48))">
   APP_DOMAIN=app.my-qa-inbox.com
   RECEIVING_DOMAINS=["my-qa-inbox.com"]
   INBOUND_ADAPTERS=["cloudflare"]
   INBOUND_WEBHOOK_SECRET=<python -c "import secrets; print(secrets.token_urlsafe(48))">
   MINIO_ROOT_PASSWORD=<long random value>
   DEMO_MODE=false
   ```
4. **Start**:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   docker compose exec api python -m app.cli create-admin you@example.com
   ```
   Caddy obtains and renews a Let's Encrypt certificate for `APP_DOMAIN` automatically. Ports 80 and 443 must be reachable.
5. **Database**: the bundled PostgreSQL 16 keeps its data in the `pgdata` volume. To use a managed PostgreSQL instead, set `DATABASE_URL=postgresql+psycopg://user:pass@host:5432/db?sslmode=require`. The `migrate` service runs `alembic upgrade head` on every start. Back up with `pg_dump` (or your provider's backups) **and** the object store together.
6. **Worker and scheduler**: the `worker` service (Celery) processes deliveries; `beat` runs the hourly retention cleanup and the 5-minute re-queue. Both must run. Scale throughput with `docker compose up -d --scale worker=3`.
7. **Object storage**: the bundled MinIO is private (no anonymous policy). To use S3, Cloudflare R2, Backblaze B2 or similar instead, set `S3_ENDPOINT_URL`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and **keep the bucket private**: users only ever download through short-lived signed links issued by the API.
8. **Redis**: the bundled Redis (append-only file on) serves as the Celery broker and holds the rate-limit counters.

## 3A. Cloudflare Email Routing + Email Worker

1. Add `my-qa-inbox.com` to Cloudflare (its nameservers must be Cloudflare's).
2. Dashboard → your domain → **Email** → **Email Routing** → enable it. **Cloudflare adds the required DNS records itself** during onboarding: MX records for `route1.mx.cloudflare.net`, `route2.mx.cloudflare.net` and `route3.mx.cloudflare.net` (priorities are assigned by Cloudflare) and the SPF TXT record `v=spf1 include:_spf.mx.cloudflare.net ~all`. Use the exact records shown in your dashboard rather than typing your own.
3. Deploy the Worker from `cloudflare-worker/`:
   ```bash
   cd cloudflare-worker
   # set INBOUND_URL in wrangler.toml to https://app.my-qa-inbox.com/api/inbound/raw
   npx wrangler deploy
   npx wrangler secret put INBOUND_WEBHOOK_SECRET      # same value as in .env
   ```
4. Email Routing → **Routing rules** → **Catch-all address** → action **Send to a Worker** → `mailbox-inbound` → enable.
5. Test it: create a mailbox in the UI and send a message to it from any external mail account. Then confirm the delivery in Admin → Deliveries.

Behaviour: the Worker relays each message with an HMAC signature, the backend rejects invalid or stale signatures (older than 5 minutes) with `401`, and replays are absorbed by de-duplication. For unknown or expired addresses the backend returns `404` and the Worker calls `setReject()`, so the sender gets a bounce. On other errors the Worker throws. I could not find Cloudflare documentation saying whether a thrown Worker produces a temporary failure (the sender retries) or a bounce, so **send a test message while the API is stopped** to see what your sender does. Large messages hash and stream inside the Worker; Cloudflare recommends the Workers Paid plan for higher CPU limits if Free-plan invocations hit `EXCEEDED_CPU`.

## 3B. Built-in SMTP receiver (port 25)

1. Make sure **inbound TCP 25** reaches your server. Some cloud and home providers block port 25; check with yours.
2. DNS records for the receiving domain:
   ```
   mx.my-qa-inbox.com.   A     <server IPv4>
   my-qa-inbox.com.      MX 10 mx.my-qa-inbox.com.
   ```
   Do not point an MX record at a CNAME. These are your own records, so the values come from your server, not from a provider.
3. `.env`: `INBOUND_ADAPTERS=["smtp"]`, `SMTP_HOSTNAME=mx.my-qa-inbox.com`. For STARTTLS, mount a certificate and set `SMTP_TLS_CERT` and `SMTP_TLS_KEY` (PEM paths inside the container). Without them, mail is accepted over plaintext SMTP, which most senders allow.
4. `docker-compose.prod.yml` publishes host port 25 to the receiver's 2525. The receiver refuses relaying (other domains), unknown recipients (`550 5.1.1`), oversize messages (`552`), blocked senders, and senders that exceed `RL_INBOUND_PER_IP_PER_MINUTE`.

## 3C. Mailgun Routes

1. Add the receiving domain in Mailgun and create the DNS records **exactly as the Mailgun dashboard lists them**. Mailgun's domain verification guide lists the receiving MX records as `10 mxa.mailgun.org` and `10 mxb.mailgun.org`. EU-region accounts may show different hosts, so copy what your dashboard shows.
2. **Receiving → Routes → Create route**: expression *Catch All* (or `match_recipient(".*@my-qa-inbox.com")`), action **Forward** to `https://app.my-qa-inbox.com/api/inbound/mailgun/mime`. The URL must end in `mime` so that Mailgun posts the raw message as `body-mime`.
3. `.env`: `INBOUND_ADAPTERS=["mailgun"]` and `MAILGUN_WEBHOOK_SIGNING_KEY=` set to the **HTTP webhook signing key** (Settings → API Security).
4. Responses: `200` means accepted; `406` means "do not retry" (unknown recipient, too large, wrong route URL); other statuses make Mailgun retry for up to 8 hours. Signatures older than `MAILGUN_TIMESTAMP_TOLERANCE_SECONDS` (12 h by default, to cover that retry window) are rejected, and duplicates are collapsed.

## 4. Abuse controls for a public service

- Tune the `RL_*` limits, `TEMP_MAILBOX_*` caps, `REGISTRATION_OPEN` and `CUSTOM_LOCAL_PART_ALLOWED`.
- Admin → Abuse: block a sender, sender domain, IP (stored only as a keyed hash) or a mailbox; disable a mailbox by address; run cleanup.
- Optional malware scanning: `docker compose --profile clamav up -d` and `SCANNER=clamav`.
- Publish an acceptable-use page and a contact address. Note that the reserved local parts (`postmaster`, `abuse`, …) cannot be claimed by users.
- Watch Admin → Overview → *Deliveries (24 h)* and *failed* counts.

## 5. Checklist

- [ ] `SECRET_KEY`, `INBOUND_WEBHOOK_SECRET` / `MAILGUN_WEBHOOK_SIGNING_KEY` and `MINIO_ROOT_PASSWORD` are long random values, and `.env` is not in git
- [ ] `DEMO_MODE=false` (or keep it on deliberately; samples are always labelled)
- [ ] HTTPS works on `APP_DOMAIN`; ports 9000/9001/5432/6379 are **not** exposed publicly
- [ ] MX records resolve (`dig MX my-qa-inbox.com`), and a message from an external account arrives
- [ ] An admin account exists; Admin → Overview shows database, storage and redis as `ok`
- [ ] Backups of PostgreSQL and the bucket are scheduled
