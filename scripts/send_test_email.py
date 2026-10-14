"""Send a real test e-mail over SMTP to the local receiver (or any SMTP server you point it at).

    python scripts/send_test_email.py you@mailbox.localhost
    python scripts/send_test_email.py you@mailbox.localhost --subject "Reset" --attach report.pdf --html
    python scripts/send_test_email.py you@mailbox.localhost --host localhost --port 2525

This performs a genuine SMTP transaction (EHLO/MAIL/RCPT/DATA); it is how an application under test
would deliver mail to a local M-Ai-L Box. Standard library only.
"""
from __future__ import annotations

import argparse
import mimetypes
import random
import smtplib
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
from datetime import datetime, timezone
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("to", nargs="+")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=2525)
    ap.add_argument("--sender", default="Test App <noreply@app-under-test.example>")
    ap.add_argument("--subject", default=None)
    ap.add_argument("--html", action="store_true", help="add an HTML alternative with a link and a remote image")
    ap.add_argument("--attach", action="append", default=[], help="file to attach (repeatable)")
    args = ap.parse_args()

    code = f"{random.randint(0, 999999):06d}"
    msg = EmailMessage()
    msg["From"] = args.sender
    msg["To"] = ", ".join(args.to)
    msg["Subject"] = args.subject or f"Your verification code is {code}"
    msg["Date"] = format_datetime(datetime.now(timezone.utc))
    msg["Message-ID"] = make_msgid(domain="app-under-test.example")
    msg.set_content(f"Hello,\n\nYour verification code is {code}.\n\nConfirm: https://app-under-test.example/confirm?c={code}\n")
    if args.html:
        msg.add_alternative(
            f"<p>Hello,</p><p>Your verification code is <b>{code}</b>.</p>"
            f"<p><a href='https://app-under-test.example/confirm?c={code}'>Confirm your email</a></p>"
            "<img src='https://app-under-test.example/open.gif' width='1' height='1'>", subtype="html")
    for path in args.attach:
        p = Path(path)
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        maintype, subtype = ctype.split("/", 1)
        msg.add_attachment(p.read_bytes(), maintype=maintype, subtype=subtype, filename=p.name)

    with smtplib.SMTP(args.host, args.port, timeout=30) as smtp:
        refused = smtp.send_message(msg)
    print(f"sent '{msg['Subject']}' to {', '.join(a for a in args.to if a not in refused)}")
    for addr, (code_, reason) in refused.items():
        print(f"refused {addr}: {code_} {reason.decode(errors='replace')}")


if __name__ == "__main__":
    main()
