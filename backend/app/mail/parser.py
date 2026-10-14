"""Robust MIME parsing with Python's standard `email` package.

Everything here handles untrusted input: malformed headers, unknown charsets, broken
encodings and hostile filenames must never raise out of `parse_message`.
"""
from __future__ import annotations

import hashlib
import html as htmllib
import os
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email import policy
from email.header import decode_header, make_header
from email.message import EmailMessage, Message
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
from html.parser import HTMLParser

MAX_PARTS = 500
MAX_HEADERS = 500
MAX_HEADER_VALUE = 8192
_CT_RE = re.compile(r"^[a-z0-9!#$&^_.+-]{1,64}/[a-z0-9!#$&^_.+-]{1,128}$")
_WIN_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
_BIDI_CTRL = re.compile("[‎‏‪-‮⁦-⁩]")
_EXT_FOR_TYPE = {
    "text/plain": ".txt", "text/html": ".html", "text/calendar": ".ics", "text/csv": ".csv",
    "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp",
    "application/pdf": ".pdf", "application/zip": ".zip", "message/rfc822": ".eml",
    "application/json": ".json",
}


@dataclass
class Address:
    name: str | None
    address: str

    def to_dict(self) -> dict:
        return {"name": self.name, "address": self.address}


@dataclass
class ParsedAttachment:
    filename: str
    content_type: str
    data: bytes
    content_id: str | None = None
    is_inline: bool = False

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


@dataclass
class ParsedMessage:
    subject: str = ""
    from_: Address | None = None
    to: list[Address] = field(default_factory=list)
    cc: list[Address] = field(default_factory=list)
    reply_to: list[Address] = field(default_factory=list)
    message_id: str | None = None
    sent_at: datetime | None = None
    text_body: str = ""
    html_body: str | None = None
    headers: list[dict] = field(default_factory=list)
    attachments: list[ParsedAttachment] = field(default_factory=list)
    defects: int = 0


# --------------------------------------------------------------------------- helpers

def _decode_header_value(value) -> str:
    """Decode an RFC 2047 header value without ever raising."""
    if value is None:
        return ""
    try:
        text = str(value)
    except Exception:
        text = ""
    if "=?" in text:
        try:
            text = str(make_header(decode_header(text)))
        except Exception:
            pass
    text = text.replace("\r", "").replace("\n", " ")
    return text[:MAX_HEADER_VALUE]


def _safe_get(msg: Message, name: str) -> str | None:
    try:
        v = msg.get(name)
    except Exception:
        # Fall back to the raw, unparsed value
        for k, raw in getattr(msg, "_headers", []):
            if k.lower() == name.lower():
                return _decode_header_value(raw)
        return None
    return None if v is None else _decode_header_value(v)


def _addresses(msg: Message, name: str) -> list[Address]:
    out: list[Address] = []
    try:
        values = msg.get_all(name) or []
    except Exception:
        values = [_safe_get(msg, name) or ""]
    for raw in values:
        hdr = raw
        addrs = getattr(hdr, "addresses", None)
        try:
            if addrs is not None:
                for a in addrs:
                    spec = (a.addr_spec or "").strip()
                    if spec and spec != "<>":
                        out.append(Address(_decode_header_value(a.display_name) or None, spec[:320]))
                continue
        except Exception:
            pass
        for nm, spec in getaddresses([_decode_header_value(raw)]):
            if spec:
                out.append(Address(_decode_header_value(nm) or None, spec[:320]))
    return out[:200]


def _decode_bytes(payload: bytes, charset: str | None) -> str:
    for cs in (charset, "utf-8", "cp1252"):
        if not cs:
            continue
        try:
            return payload.decode(cs)
        except (LookupError, UnicodeDecodeError):
            continue
    return payload.decode("utf-8", errors="replace")


def _part_charset(part: Message) -> str | None:
    try:
        cs = part.get_content_charset()
    except Exception:
        return None
    if cs and cs.lower() in ("unknown-8bit", "x-unknown", "unknown", "default"):
        return None
    return cs


def _part_bytes(part: Message) -> bytes:
    try:
        data = part.get_payload(decode=True)
    except Exception:
        data = None
    if data is None:
        try:
            raw = part.get_payload()
            data = raw.encode("utf-8", errors="replace") if isinstance(raw, str) else b""
        except Exception:
            data = b""
    return data


def _content_type(part: Message) -> str:
    try:
        ct = (part.get_content_type() or "application/octet-stream").lower()
    except Exception:
        ct = "application/octet-stream"
    return ct if _CT_RE.match(ct) else "application/octet-stream"


def _disposition(part: Message) -> str | None:
    try:
        d = part.get_content_disposition()
    except Exception:
        return None
    return d.lower() if d else None


def _filename(part: Message) -> str | None:
    try:
        name = part.get_filename()
    except Exception:
        name = None
    if not name:
        try:
            name = part.get_param("name")  # legacy Content-Type name=
            if isinstance(name, tuple):
                name = name[2]
        except Exception:
            name = None
    return _decode_header_value(name) if name else None


def safe_filename(name: str | None, content_type: str = "application/octet-stream", index: int = 1) -> str:
    """Make an untrusted filename safe to store and to offer for download."""
    name = unicodedata.normalize("NFC", name or "")
    name = name.replace("\\", "/").split("/")[-1]
    name = _BIDI_CTRL.sub("", name)
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)
    name = re.sub(r'[<>:"|?*;]', "_", name)
    name = name.strip(" .")
    if name and name.split(".")[0].upper() in _WIN_RESERVED:
        name = "_" + name
    if not name:
        name = f"attachment-{index}{_EXT_FOR_TYPE.get(content_type, '.bin')}"
    if len(name) > 180:
        stem, ext = os.path.splitext(name)
        ext = ext[:16]
        name = stem[: 180 - len(ext)] + ext
    return name


class _TextExtractor(HTMLParser):
    _BLOCK = {"p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "blockquote", "pre", "hr"}
    _SKIP = {"script", "style", "head", "title"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self._skip += 1
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self._SKIP:
            self._skip = max(0, self._skip - 1)
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    p = _TextExtractor()
    try:
        p.feed(html)
        p.close()
    except Exception:
        return re.sub(r"<[^>]+>", " ", html)
    text = "".join(p.parts)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _walk(msg: Message, depth: int = 0):
    """Yield leaf parts without descending into attached messages (message/rfc822)."""
    if depth > 20:
        return
    try:
        is_multi = msg.is_multipart()
    except Exception:
        is_multi = False
    if is_multi and _content_type(msg) != "message/rfc822":
        try:
            children = msg.get_payload()
        except Exception:
            children = []
        for child in children or []:
            if isinstance(child, Message):
                yield from _walk(child, depth + 1)
    else:
        yield msg


def _rfc822_bytes(part: Message) -> bytes:
    try:
        inner = part.get_payload()
        if isinstance(inner, list) and inner:
            return inner[0].as_bytes(policy=policy.compat32)
    except Exception:
        pass
    return _part_bytes(part)


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value)
    except Exception:
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    try:
        return dt.astimezone(timezone.utc)
    except (OverflowError, ValueError):
        return None


def normalize_message_id(mid: str | None) -> str | None:
    if not mid:
        return None
    mid = mid.strip()
    m = re.search(r"<([^<>\s]{1,900})>", mid)
    value = m.group(1) if m else mid.strip("<> ")
    return value.lower() or None


# --------------------------------------------------------------------------- main entry

def parse_message(raw: bytes) -> ParsedMessage:
    msg: EmailMessage = BytesParser(policy=policy.default).parsebytes(raw)  # type: ignore[assignment]
    out = ParsedMessage()
    out.defects = len(getattr(msg, "defects", []) or [])

    try:
        raw_items = list(msg.raw_items())
    except Exception:
        raw_items = list(getattr(msg, "_headers", []))
    for name, value in raw_items[:MAX_HEADERS]:
        out.headers.append({"name": str(name)[:200], "value": _decode_header_value(value)})

    out.subject = (_safe_get(msg, "Subject") or "").strip()[:2000]
    froms = _addresses(msg, "From")
    out.from_ = froms[0] if froms else None
    out.to = _addresses(msg, "To")
    out.cc = _addresses(msg, "Cc")
    out.reply_to = _addresses(msg, "Reply-To")
    mid = _safe_get(msg, "Message-ID")
    out.message_id = mid.strip()[:998] if mid else None
    out.sent_at = _parse_date(_safe_get(msg, "Date"))

    texts: list[str] = []
    html: str | None = None
    for index, part in enumerate(_walk(msg), start=1):
        if index > MAX_PARTS:
            break
        ctype = _content_type(part)
        disp = _disposition(part)
        fname = _filename(part)
        is_body_candidate = disp != "attachment" and not fname

        if ctype == "text/plain" and is_body_candidate:
            texts.append(_decode_bytes(_part_bytes(part), _part_charset(part)))
            continue
        if ctype == "text/html" and is_body_candidate and html is None:
            html = _decode_bytes(_part_bytes(part), _part_charset(part))
            continue

        data = _rfc822_bytes(part) if ctype == "message/rfc822" else _part_bytes(part)
        if not data and not fname:
            continue
        cid = _safe_get(part, "Content-ID")
        cid = cid.strip()[:250] if cid else None
        out.attachments.append(
            ParsedAttachment(
                filename=safe_filename(fname, ctype, len(out.attachments) + 1),
                content_type=ctype,
                data=data,
                content_id=cid,
                is_inline=bool(cid) and disp != "attachment",
            )
        )

    out.html_body = html
    text = "\n\n".join(t for t in texts if t.strip())
    if not text and html:
        text = html_to_text(html)
    out.text_body = text.replace("\r\n", "\n")
    return out


def make_snippet(text: str, length: int = 160) -> str:
    s = re.sub(r"\s+", " ", htmllib.unescape(text or "")).strip()
    return s[:length]


# Magic-byte sniffing — previews are only offered when the bytes match a safe type.
def sniff_previewable(data_head: bytes) -> tuple[str, str] | None:
    """Return (kind, mime) for safely previewable content, based on the bytes, not the claimed type."""
    if data_head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image", "image/png"
    if data_head.startswith(b"\xff\xd8\xff"):
        return "image", "image/jpeg"
    if data_head[:6] in (b"GIF87a", b"GIF89a"):
        return "image", "image/gif"
    if data_head[:4] == b"RIFF" and data_head[8:12] == b"WEBP":
        return "image", "image/webp"
    if data_head.startswith(b"%PDF-"):
        return "pdf", "application/pdf"
    return None
