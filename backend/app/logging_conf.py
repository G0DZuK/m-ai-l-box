"""Logging that never records credentials. Message contents are never passed to loggers at all."""
from __future__ import annotations

import logging
import re

_PATTERNS = [
    (re.compile(r"(mbx_|ses_|mak_)[A-Za-z0-9_\-]{8,}"), r"\1[REDACTED]"),
    (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9_\-.]+"), r"\1[REDACTED]"),
    (re.compile(r"(/api/download/)[A-Za-z0-9_\-.]+"), r"\1[REDACTED]"),
    (re.compile(r"(?i)(password|token|signature|secret)([\"']?\s*[:=]\s*[\"']?)[^\s\"'&,]+"), r"\1\2[REDACTED]"),
]


def redact(text: str) -> str:
    for pat, repl in _PATTERNS:
        text = pat.sub(repl, text)
    return text


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            return True
        clean = redact(msg)
        if clean != msg:
            record.msg = clean
            record.args = ()
        return True


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if not any(isinstance(f, RedactingFilter) for h in root.handlers for f in h.filters):
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        handler.addFilter(RedactingFilter())
        root.handlers = [handler]
    root.setLevel(level)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "celery", "mail.log"):
        lg = logging.getLogger(name)
        for h in lg.handlers:
            h.addFilter(RedactingFilter())
        lg.addFilter(RedactingFilter())
    # aiosmtpd's protocol logger can echo envelope data at DEBUG; keep it at INFO or above.
    logging.getLogger("mail.log").setLevel(max(logging.INFO, root.level))
