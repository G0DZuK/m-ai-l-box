"""Tokens, password hashing and signed download links."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from .config import get_settings

MAILBOX_PREFIX = "mbx_"
SESSION_PREFIX = "ses_"
API_KEY_PREFIX = "mak_"

_ph = PasswordHasher()  # argon2id with library defaults


def new_token(prefix: str) -> str:
    # 32 bytes = 256 bits of entropy from the OS CSPRNG
    return prefix + secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Tokens are high-entropy, so a keyed SHA-256 is sufficient (no slow KDF needed)."""
    key = get_settings().secret_key.encode()
    return hmac.new(key, token.encode(), hashlib.sha256).hexdigest()


def token_hint(token: str) -> str:
    return token[:8] + "…"


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


_DUMMY_HASH: str | None = None


def burn_password_check(password: str) -> None:
    """Spend comparable time when the user does not exist (limits user enumeration by timing)."""
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = _ph.hash("dummy-password-for-timing")
    verify_password(_DUMMY_HASH, password)


def hash_ip(ip: str | None) -> str | None:
    if not ip:
        return None
    key = (get_settings().secret_key + ":ip").encode()
    return hmac.new(key, ip.encode(), hashlib.sha256).hexdigest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _sign(payload: bytes) -> str:
    key = (get_settings().secret_key + ":download").encode()
    return _b64(hmac.new(key, payload, hashlib.sha256).digest())


def make_download_token(
    storage_key: str, filename: str, content_type: str, disposition: str, ttl: int | None = None
) -> str:
    ttl = ttl or get_settings().download_link_ttl_seconds
    payload = json.dumps(
        {"k": storage_key, "n": filename, "t": content_type, "d": disposition, "e": int(time.time()) + ttl},
        separators=(",", ":"),
    ).encode()
    return f"{_b64(payload)}.{_sign(payload)}"


def read_download_token(token: str) -> dict[str, Any] | None:
    try:
        body, sig = token.split(".", 1)
        payload = _unb64(body)
    except (ValueError, TypeError):
        return None
    if not hmac.compare_digest(_sign(payload), sig):
        return None
    try:
        data = json.loads(payload)
    except ValueError:
        return None
    if int(data.get("e", 0)) < int(time.time()):
        return None
    return data
