"""QA helpers: detect one-time codes and collect links. Read-only — message content is never modified."""
from __future__ import annotations

import re
from html.parser import HTMLParser

_KEYWORDS = re.compile(
    r"(?i)\b(code|otp|passcode|pass code|pin|verification|verify|one[- ]?time|security|login|"
    r"sign[- ]?in|2fa|mfa|authenticat\w*|confirm\w*|token|kod|código|codice|code de)\b"
)
_NUMERIC = re.compile(r"(?<![\w./:#-])(\d{3}[- ]\d{3}|\d{4,8})(?![\w/:-]|\.\d)")
_ALNUM = re.compile(r"(?<![\w-])((?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,8})(?![\w-])")
_URL_RE = re.compile(r"""(?i)\b(?:https?://|mailto:)[^\s<>"'`\]\[(){}]+""")
_TRAILING = ".,;:!?'\")]}>"
MAX_LINKS = 200


def _context(text: str, start: int, end: int, width: int = 48) -> str:
    snippet = text[max(0, start - width): end + width]
    return re.sub(r"\s+", " ", snippet).strip()


def find_otp_codes(subject: str, text: str, limit: int = 5) -> list[dict]:
    found: list[dict] = []
    seen: set[str] = set()
    for source in (subject or "", (text or "")[:20000]):
        for regex, window in ((_NUMERIC, 80), (_ALNUM, 40)):
            for m in regex.finditer(source):
                code = m.group(1)
                compact = re.sub(r"[- ]", "", code)
                if compact in seen:
                    continue
                around = source[max(0, m.start() - window): m.end() + window // 2]
                if not _KEYWORDS.search(around):
                    continue
                if regex is _NUMERIC and len(compact) == 4 and 1900 <= int(compact) <= 2100:
                    # Probably a year unless directly labelled as a code
                    if not re.search(r"(?i)(code|otp|pin)\W{0,3}$", source[max(0, m.start() - 12): m.start()]):
                        continue
                seen.add(compact)
                found.append({"code": compact, "context": _context(source, m.start(), m.end())})
                if len(found) >= limit:
                    return found
    return found


class _LinkCollector(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: list[dict] = []
        self._current: dict | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in ("a", "area"):
            href = dict(attrs).get("href")
            if href:
                self._current = {"url": href.strip(), "source": "html"}
                self._text = []
                if tag == "area":
                    self._finish()

    def handle_data(self, data):
        if self._current is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._current is not None:
            self._finish()

    def _finish(self):
        assert self._current is not None
        text = re.sub(r"\s+", " ", "".join(self._text)).strip()
        self._current["text"] = text[:200] or None
        self.links.append(self._current)
        self._current = None


def _acceptable(url: str) -> bool:
    u = url.lower()
    return (u.startswith("http://") or u.startswith("https://") or u.startswith("mailto:")) and len(url) <= 2048


def extract_links(html: str | None, text: str | None) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    if html:
        p = _LinkCollector()
        try:
            p.feed(html[:2_000_000])
            p.close()
        except Exception:
            pass
        for link in p.links:
            url = link["url"]
            if _acceptable(url) and url not in seen:
                seen.add(url)
                out.append(link)
    for m in _URL_RE.finditer((text or "")[:2_000_000]):
        url = m.group(0).rstrip(_TRAILING)
        if _acceptable(url) and url not in seen:
            seen.add(url)
            out.append({"url": url, "text": None, "source": "text"})
        if len(out) >= MAX_LINKS:
            break
    return out[:MAX_LINKS]
