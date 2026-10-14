"""DEMO MODE ONLY: sample messages generated locally.

These are built in-process and pushed through the same parser as real mail so the UI has something to
show, but they are flagged `is_demo` everywhere and prove nothing about real e-mail delivery.
"""
from __future__ import annotations

import struct
import zlib
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db, utcnow
from .deps import Principal, get_principal
from .mail.ingest import accept_delivery, process_delivery
from .ratelimit import enforce
from .schemas import MailboxWithToken
from .security import hash_ip
from .services import create_mailbox

router = APIRouter(prefix="/api/demo", tags=["demo"])

SAMPLE_SENDER = "samples@demo.invalid"


def _png(width: int = 48, height: int = 48, rgb=(79, 70, 229)) -> bytes:
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def _pdf() -> bytes:
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        None,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    stream = b"BT /F1 18 Tf 24 72 Td (Sample invoice - DEMO) Tj ET"
    objs[3] = b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"
    out = b"%PDF-1.4\n"
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return out


def _base(to: str, subject: str, sender: str = f"Sample App <{SAMPLE_SENDER}>") -> EmailMessage:
    m = EmailMessage()
    m["From"] = sender
    m["To"] = to
    m["Subject"] = subject
    m["Date"] = format_datetime(utcnow())
    m["Message-ID"] = make_msgid(domain="demo.invalid")
    m["X-Demo-Sample"] = "true"
    return m


def sample_messages(to: str) -> list[bytes]:
    msgs = []

    m = _base(to, "[DEMO] Your verification code is 482913")
    m.set_content("Hi there,\n\nYour verification code is 482913. It expires in 10 minutes.\n\n"
                  "If you didn't request this, ignore this email.\n\n— Sample App (demo message)")
    m.add_alternative(
        "<div style='font-family:sans-serif'><h2>Verify your email</h2><p>Your verification code is</p>"
        "<p style='font-size:28px;letter-spacing:4px'><b>482913</b></p><p>It expires in 10 minutes.</p>"
        "<p><a href='https://example.com/verify?token=demo-123'>Or click here to verify</a></p>"
        "<p style='color:#888'>This is a DEMO sample message.</p></div>", subtype="html")
    msgs.append(m)

    m = _base(to, "[DEMO] Reset your password", "Accounts Team <accounts@demo.invalid>")
    m.set_content("We received a request to reset your password.\n\nReset it here: https://example.com/reset?t=abc123\n\n"
                  "Questions? Visit https://example.com/help\n\n(demo message)")
    msgs.append(m)

    m = _base(to, "[DEMO] Invoice INV-2041 with attachment", "Billing <billing@demo.invalid>")
    m.set_content("Please find your invoice attached.\n\n(demo message)")
    cid = make_msgid(domain="demo.invalid")
    m.add_alternative(
        f"<p>Please find your invoice attached.</p><p><img src='cid:{cid[1:-1]}' alt='inline sample image'></p>"
        "<p>Remote tracking pixel below is blocked by default:</p>"
        "<img src='https://example.com/pixel.gif' width='1' height='1'><p style='color:#888'>DEMO sample.</p>",
        subtype="html")
    m.get_payload()[1].add_related(_png(), "image", "png", cid=cid, filename="banner.png")
    m.add_attachment(_pdf(), maintype="application", subtype="pdf", filename="INV-2041.pdf")
    m.add_attachment("id,amount\n2041,19.99\n".encode(), maintype="text", subtype="csv", filename="line-items.csv")
    msgs.append(m)

    m = _base(to, "[DEMO] Ünïcödé newsletter — 日本語 · Ελληνικά · emoji ✉️", "Newsletter <news@demo.invalid>")
    m.set_content("Grüße! こんにちは. Καλημέρα. This sample checks Unicode handling.\n\n(demo message)")
    msgs.append(m)

    return [x.as_bytes() for x in msgs]


@router.post("/mailbox", status_code=201, response_model=MailboxWithToken, summary="Create a DEMO mailbox with sample messages")
def demo_mailbox(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    if not get_settings().demo_mode:
        raise HTTPException(404, "Demo mode is disabled on this server.")
    enforce(f"mbcreate:ip:{p.ip}", get_settings().rl_mailbox_create_per_hour, 3600, "Too many new mailboxes")
    mb, token = create_mailbox(db, label="Demo mailbox (sample messages)", is_demo=True, ip_hash=hash_ip(p.ip))
    for raw in sample_messages(mb.address):
        res = accept_delivery(db, raw, [mb.address], SAMPLE_SENDER, "demo", enqueue=False)
        if res.delivery_id and res.accepted:
            process_delivery(res.delivery_id)
    from .routers.mailboxes import mailbox_counts

    return MailboxWithToken(mailbox=mailbox_counts(db, mb), token=token)
