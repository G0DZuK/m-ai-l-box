"""Malware-scanning integration point.

SCANNER=none   → files are stored with scan_status "not_scanned" (the UI says so).
SCANNER=clamav → each attachment/upload is streamed to clamd (INSTREAM) before it is stored.
                 "infected" files are kept for audit but cannot be downloaded.
                 "error" (scanner unreachable/timeout) files remain downloadable with a warning.
Scanning reduces risk but cannot guarantee a file is safe (zero-days, encrypted archives, size caps).
"""
from __future__ import annotations

import logging
import socket
import struct

from .config import get_settings

log = logging.getLogger(__name__)

NOT_SCANNED, CLEAN, INFECTED, ERROR = "not_scanned", "clean", "infected", "error"


def _clamav_scan(data: bytes) -> str:
    s = get_settings()
    try:
        with socket.create_connection((s.clamav_host, s.clamav_port), timeout=30) as sock:
            sock.sendall(b"zINSTREAM\0")
            view = memoryview(data)
            for i in range(0, len(view), 1024 * 1024):
                chunk = view[i: i + 1024 * 1024]
                sock.sendall(struct.pack("!L", len(chunk)) + chunk)
            sock.sendall(struct.pack("!L", 0))
            reply = b""
            while not reply.endswith(b"\0"):
                buf = sock.recv(4096)
                if not buf:
                    break
                reply += buf
    except OSError as exc:
        log.warning("clamav scan failed: %s", type(exc).__name__)
        return ERROR
    text = reply.rstrip(b"\0").decode("ascii", "replace")
    if text.endswith("OK"):
        return CLEAN
    if "FOUND" in text:
        return INFECTED
    return ERROR


def scan_bytes(data: bytes) -> str:
    if get_settings().scanner == "clamav":
        return _clamav_scan(data)
    return NOT_SCANNED
