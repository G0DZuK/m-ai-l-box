"""Webhook adapters for inbound e-mail providers.

* POST /api/inbound/raw          — generic signed raw-MIME relay, used by the bundled Cloudflare Email Worker
* POST /api/inbound/mailgun/mime — Mailgun Routes forward() to a URL ending in "mime" (field body-mime)

Both verify an HMAC signature before reading the message into the shared pipeline (app.mail.ingest).
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import time
from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..mail.ingest import accept_delivery

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/inbound", tags=["inbound (machine-to-machine)"], include_in_schema=True)


async def _read_body(request: Request, limit: int) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(413, "Message too large")
    buf = bytearray()
    async for chunk in request.stream():
        buf.extend(chunk)
        if len(buf) > limit:
            raise HTTPException(413, "Message too large")
    return bytes(buf)


def raw_signature(secret: str, timestamp: str, envelope_from: str, envelope_to: str, body: bytes) -> str:
    msg = f"{timestamp}.{envelope_from}.{envelope_to}.{hashlib.sha256(body).hexdigest()}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def mailgun_signature(signing_key: str, timestamp: str, token: str) -> str:
    return hmac.new(signing_key.encode(), f"{timestamp}{token}".encode(), hashlib.sha256).hexdigest()


def _fresh(timestamp: str, tolerance: int) -> bool:
    try:
        return abs(time.time() - int(timestamp)) <= tolerance
    except (TypeError, ValueError):
        return False


@router.post("/raw", summary="Signed raw MIME relay (Cloudflare Email Worker)")
async def inbound_raw(request: Request, db: Session = Depends(get_db)):
    s = get_settings()
    if "cloudflare" not in s.inbound_adapters or not s.inbound_webhook_secret:
        raise HTTPException(404, "Not found")
    ts = request.headers.get("x-mailbox-timestamp", "")
    sig = request.headers.get("x-mailbox-signature", "")
    env_from = request.headers.get("x-envelope-from", "")
    env_to = request.headers.get("x-envelope-to", "")
    body = await _read_body(request, s.max_message_bytes + 1)
    expected = raw_signature(s.inbound_webhook_secret, ts, env_from, env_to, body)
    if not sig or not hmac.compare_digest(expected, sig) or not _fresh(ts, s.inbound_webhook_tolerance_seconds):
        log.warning("rejected inbound webhook with bad or stale signature")
        raise HTTPException(401, "Invalid signature")
    if len(body) > s.max_message_bytes:
        raise HTTPException(413, "Message too large")
    rcpts = [r.strip() for r in env_to.split(",") if r.strip()]
    result = await run_in_threadpool(accept_delivery, db, body, rcpts, env_from or None, "cloudflare")
    if result.error == "too_large":
        raise HTTPException(413, "Message too large")
    if result.error == "blocked_sender":
        return JSONResponse({"detail": "Sender blocked", "accepted": []}, status_code=403)
    if not result.accepted and s.unknown_recipient_policy == "reject":
        return JSONResponse({"detail": "No such mailbox", "accepted": [], "rejected": result.rejected}, status_code=404)
    return {"accepted": result.accepted, "delivery_id": str(result.delivery_id) if result.delivery_id else None}


@router.post("/mailgun/mime", summary="Mailgun Routes forward() endpoint")
async def inbound_mailgun(request: Request, db: Session = Depends(get_db)):
    s = get_settings()
    if "mailgun" not in s.inbound_adapters or not s.mailgun_webhook_signing_key:
        raise HTTPException(404, "Not found")
    ctype = request.headers.get("content-type", "")
    # Percent-encoding can triple the size of the MIME body
    limit = s.max_message_bytes * 3 + 1024 * 1024
    if ctype.startswith("multipart/form-data"):
        form = await request.form(max_files=0, max_fields=200, max_part_size=s.max_message_bytes + 1)
        fields = {k: (v if isinstance(v, str) else "") for k, v in form.items()}
    else:
        raw = await _read_body(request, limit)
        # latin-1 round-trips every byte, so 8-bit MIME content survives percent-decoding unchanged
        parsed = parse_qs(raw.decode("ascii", errors="replace"), keep_blank_values=True, max_num_fields=200,
                          encoding="latin-1")
        fields = {k: v[0] for k, v in parsed.items()}

    ts, token, sig = fields.get("timestamp", ""), fields.get("token", ""), fields.get("signature", "")
    expected = mailgun_signature(s.mailgun_webhook_signing_key, ts, token)
    if not sig or not hmac.compare_digest(expected, sig) or not _fresh(ts, s.mailgun_timestamp_tolerance_seconds):
        log.warning("rejected mailgun webhook with bad or stale signature")
        raise HTTPException(401, "Invalid signature")
    mime = fields.get("body-mime", "")
    try:
        body = mime.encode("latin-1")
    except UnicodeEncodeError:  # multipart posts arrive already decoded as UTF-8 text
        body = mime.encode("utf-8")
    if not body:
        # 406 tells Mailgun not to retry
        return JSONResponse({"detail": "Route must forward to a URL ending in 'mime'"}, status_code=406)
    if len(body) > s.max_message_bytes:
        return JSONResponse({"detail": "Message too large"}, status_code=406)
    rcpts = [r.strip() for r in fields.get("recipient", "").split(",") if r.strip()]
    # Duplicate POSTs (Mailgun retries) are absorbed by message de-duplication.
    result = await run_in_threadpool(accept_delivery, db, body, rcpts, fields.get("sender") or None, "mailgun")
    if result.error or (not result.accepted and s.unknown_recipient_policy == "reject"):
        return JSONResponse({"detail": "Not accepted", "rejected": result.rejected}, status_code=406)
    return {"accepted": result.accepted}
