"""Built-in SMTP receiver (aiosmtpd) — the "smtp" inbound adapter.

Locally, applications under test can send straight to it (localhost:2525). In production it listens on
port 25 of a host your MX record points to. Recipients are validated at RCPT time, so mail for unknown
or expired addresses is refused with 550 instead of being accepted and bounced later.

Run:  python -m app.inbound.smtp_server
"""
from __future__ import annotations

import asyncio
import logging
import ssl

from aiosmtpd.controller import Controller
from aiosmtpd.smtp import SMTP, Envelope, Session

from ..config import get_settings
from ..db import SessionLocal
from ..logging_conf import configure_logging
from ..mail.ingest import accept_delivery, check_recipient, sender_blocked
from ..ratelimit import limiter

log = logging.getLogger("mailbox.smtp")

_REASONS = {
    "domain": "550 5.7.1 Relaying denied: this server only receives mail for its own domains",
    "unknown": "550 5.1.1 Mailbox does not exist",
    "expired": "550 5.1.1 Mailbox has expired",
    "disabled": "550 5.7.1 Mailbox disabled",
    "blocked": "550 5.7.1 Mailbox disabled",
    "full": "552 5.2.2 Mailbox full",
}


class InboundHandler:
    def _check_rcpt(self, address: str, peer_ip: str | None) -> str | None:
        db = SessionLocal()
        try:
            chk = check_recipient(db, address)
            if chk.reason is None:
                return None
            if chk.reason in ("unknown", "expired") and get_settings().unknown_recipient_policy == "discard":
                return "discard"
            return _REASONS.get(chk.reason, "550 5.1.1 Mailbox unavailable")
        finally:
            db.close()

    def _check_sender(self, mail_from: str, peer_ip: str | None) -> bool:
        db = SessionLocal()
        try:
            return sender_blocked(db, mail_from, peer_ip)
        finally:
            db.close()

    async def handle_MAIL(self, server: SMTP, session: Session, envelope: Envelope, address: str, mail_options):
        s = get_settings()
        peer_ip = session.peer[0] if isinstance(session.peer, tuple) else None
        allowed, _ = limiter.hit(f"smtp:ip:{peer_ip}", s.rl_inbound_per_ip_per_minute, 60)
        if not allowed:
            return "421 4.7.0 Too many messages, slow down"
        if await asyncio.to_thread(self._check_sender, address, peer_ip):
            return "550 5.7.1 Sender rejected"
        envelope.mail_from = address
        envelope.mail_options.extend(mail_options)
        envelope.discarded = []  # type: ignore[attr-defined]
        return "250 OK"

    async def handle_RCPT(self, server: SMTP, session: Session, envelope: Envelope, address: str, rcpt_options):
        if len(envelope.rcpt_tos) >= get_settings().smtp_max_recipients:
            return "452 4.5.3 Too many recipients"
        peer_ip = session.peer[0] if isinstance(session.peer, tuple) else None
        verdict = await asyncio.to_thread(self._check_rcpt, address, peer_ip)
        if verdict == "discard":
            envelope.discarded.append(address)  # type: ignore[attr-defined]
            return "250 OK"
        if verdict:
            return verdict
        envelope.rcpt_tos.append(address)
        envelope.rcpt_options.extend(rcpt_options)
        return "250 OK"

    async def handle_DATA(self, server: SMTP, session: Session, envelope: Envelope):
        if not envelope.rcpt_tos:
            return "250 OK"  # every recipient was discarded by policy
        peer_ip = session.peer[0] if isinstance(session.peer, tuple) else None
        raw = envelope.original_content or envelope.content
        if isinstance(raw, str):
            raw = raw.encode("utf-8", errors="surrogateescape")

        def run():
            db = SessionLocal()
            try:
                return accept_delivery(db, raw, list(envelope.rcpt_tos), envelope.mail_from, "smtp", peer_ip)
            finally:
                db.close()

        try:
            result = await asyncio.to_thread(run)
        except Exception as exc:
            log.error("could not accept message: %s", type(exc).__name__)
            return "451 4.3.0 Temporary failure, please retry"
        if result.error == "too_large":
            return "552 5.3.4 Message too big"
        if result.error == "blocked_sender":
            return "550 5.7.1 Sender rejected"
        if not result.accepted:
            return "550 5.1.1 No valid recipients"
        log.info("accepted delivery %s for %d recipient(s), %d bytes", result.delivery_id, len(result.accepted), len(raw))
        return f"250 2.0.0 OK queued as {result.delivery_id}"


def build_controller(host: str | None = None, port: int | None = None) -> Controller:
    s = get_settings()
    tls_context = None
    if s.smtp_tls_cert and s.smtp_tls_key:
        tls_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        tls_context.load_cert_chain(s.smtp_tls_cert, s.smtp_tls_key)
    return Controller(
        InboundHandler(),
        hostname=host or s.smtp_host,
        port=port if port is not None else s.smtp_port,
        server_hostname=s.smtp_hostname,
        ident="M-Ai-L Box ESMTP",
        data_size_limit=s.max_message_bytes,
        decode_data=False,
        enable_SMTPUTF8=True,
        tls_context=tls_context,
        require_starttls=False,
        auth_require_tls=False,
    )


def main() -> None:  # pragma: no cover - process entry point
    s = get_settings()
    configure_logging(s.log_level)
    if "smtp" not in s.inbound_adapters:
        log.warning("INBOUND_ADAPTERS does not include 'smtp'; starting anyway")
    controller = build_controller()
    controller.start()
    log.info("SMTP receiver listening on %s:%s for domains %s", s.smtp_host, s.smtp_port, ", ".join(s.receiving_domains))
    try:
        _block()
    finally:
        controller.stop()


def _block() -> None:  # pragma: no cover
    import signal
    import threading

    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, lambda *_: stop.set())
        except (ValueError, OSError):
            pass
    while not stop.wait(1):
        pass


if __name__ == "__main__":  # pragma: no cover
    main()
