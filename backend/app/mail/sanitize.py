"""Turn untrusted e-mail HTML into a self-contained, script-free document for a sandboxed iframe.

Defence in depth:
1. nh3 (ammonia) allow-list sanitisation — no scripts, event handlers, forms, frames, objects, SVG.
2. Remote resources (images, CSS url(), background=) are removed unless the user explicitly opts in.
3. The output document carries its own Content-Security-Policy (no scripts, no forms, images only
   from data: — or http(s) after opt-in) and is rendered by the frontend in
   <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc=...>, i.e. an opaque origin
   without script execution.
"""
from __future__ import annotations

import base64
import html as htmllib
import re
from dataclasses import dataclass

import nh3

ALLOWED_TAGS = {
    "a", "abbr", "address", "area", "b", "bdi", "bdo", "big", "blockquote", "br", "caption", "center",
    "cite", "code", "col", "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt", "em",
    "figcaption", "figure", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd",
    "li", "map", "mark", "ol", "p", "pre", "q", "rp", "rt", "ruby", "s", "samp", "small", "span",
    "strike", "strong", "style", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead",
    "time", "tr", "tt", "u", "ul", "var", "wbr",
}
CLEAN_CONTENT_TAGS = {
    "script", "noscript", "title", "template", "object", "embed", "iframe", "frame", "frameset",
    "applet", "svg", "math", "select", "textarea", "button", "head",
}
_GENERIC = {"style", "class", "id", "dir", "lang", "title", "align", "valign", "width", "height",
            "bgcolor", "color", "border", "background"}
ALLOWED_ATTRIBUTES = {
    "*": _GENERIC,
    "a": {"href", "name"},
    "area": {"href", "alt", "shape", "coords"},
    "img": {"src", "alt", "width", "height", "usemap"},
    "map": {"name"},
    "table": {"cellpadding", "cellspacing", "summary", "frame", "rules"},
    "td": {"colspan", "rowspan", "nowrap", "abbr", "headers", "scope"},
    "th": {"colspan", "rowspan", "nowrap", "abbr", "headers", "scope"},
    "col": {"span"}, "colgroup": {"span"},
    "font": {"face", "size"},
    "ol": {"start", "type", "reversed"}, "ul": {"type"}, "li": {"value"},
    "time": {"datetime"}, "details": {"open"}, "q": {"cite"}, "blockquote": {"cite"},
}
URL_SCHEMES = {"http", "https", "mailto", "tel", "cid"}

_CSS_URL = re.compile(r"url\s*\(\s*(['\"]?)(.*?)\1\s*\)", re.I | re.S)
_CSS_DANGEROUS = re.compile(r"(?i)(expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:|@import[^;]*;?)")
_STYLE_BLOCK = re.compile(r"(<style[^>]*>)(.*?)(</style>)", re.I | re.S)
_INLINE_MARK = "cid:__mbx_inline_{}__"


@dataclass
class RenderResult:
    html: str
    blocked_remote_images: int
    remote_images_loaded: bool


def _is_remote(url: str) -> bool:
    u = url.strip().lower()
    return u.startswith("http://") or u.startswith("https://") or u.startswith("//")


def _clean_css(css: str, allow_remote: bool, counter: list[int]) -> str:
    css = _CSS_DANGEROUS.sub("", css)

    def repl(m: re.Match) -> str:
        url = m.group(2).strip()
        if allow_remote and url.lower().startswith(("http://", "https://")):
            return f'url("{url}")'
        if _is_remote(url):
            counter[0] += 1
        return "none"

    return _CSS_URL.sub(repl, css)


def render_email_html(
    html: str,
    inline_images: dict[str, tuple[str, bytes]] | None = None,
    allow_remote_images: bool = False,
    max_inline_bytes: int = 2 * 1024 * 1024,
) -> RenderResult:
    """`inline_images` maps a normalised Content-ID (without <>) to (mime, bytes)."""
    inline_images = inline_images or {}
    blocked = [0]
    inline_slots: list[str] = []
    cid_to_slot: dict[str, int] = {}
    budget = [max_inline_bytes * 4]

    def attr_filter(tag: str, attr: str, value: str) -> str | None:
        if attr == "style":
            return _clean_css(value, allow_remote_images, blocked)
        if attr == "background":
            if _is_remote(value):
                if allow_remote_images and value.strip().lower().startswith(("http://", "https://")):
                    return value
                blocked[0] += 1
            return None
        if tag == "img" and attr == "src":
            v = value.strip()
            if v.lower().startswith("cid:"):
                cid = v[4:].strip("<> ").lower()
                img = inline_images.get(cid)
                if img is None or len(img[1]) > max_inline_bytes or len(img[1]) > budget[0]:
                    return None
                if cid not in cid_to_slot:
                    budget[0] -= len(img[1])
                    cid_to_slot[cid] = len(inline_slots)
                    inline_slots.append(f"data:{img[0]};base64,{base64.b64encode(img[1]).decode()}")
                return _INLINE_MARK.format(cid_to_slot[cid])
            if _is_remote(v):
                if allow_remote_images and v.lower().startswith(("http://", "https://")):
                    return v
                blocked[0] += 1
                return None
            return None  # data:, relative and other sources are dropped
        return value

    clean = nh3.clean(
        html,
        tags=ALLOWED_TAGS,
        clean_content_tags=CLEAN_CONTENT_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        attribute_filter=attr_filter,
        strip_comments=True,
        link_rel="noopener noreferrer nofollow",
        url_schemes=URL_SCHEMES,
        set_tag_attribute_values={"a": {"target": "_blank"}},
    )

    # <style> blocks are kept for layout fidelity but scrubbed of imports/remote URLs.
    clean = _STYLE_BLOCK.sub(
        lambda m: m.group(1) + _clean_css(m.group(2), allow_remote_images, blocked).replace("<", "") + m.group(3),
        clean,
    )

    for i, data_uri in enumerate(inline_slots):
        clean = clean.replace(f'src="{_INLINE_MARK.format(i)}"', f'src="{htmllib.escape(data_uri)}"')

    img_src = "data: https: http:" if allow_remote_images else "data:"
    csp = (
        "default-src 'none'; "
        f"img-src {img_src}; "
        "style-src 'unsafe-inline'; font-src data:; "
        "form-action 'none'; base-uri 'none'; frame-src 'none'; connect-src 'none'; media-src 'none'"
    )
    doc = (
        "<!doctype html><html><head><meta charset=\"utf-8\">"
        f"<meta http-equiv=\"Content-Security-Policy\" content=\"{csp}\">"
        "<meta name=\"referrer\" content=\"no-referrer\">"
        "<meta name=\"color-scheme\" content=\"light\">"
        "<style>html,body{margin:0;padding:0;background:#fff;color:#111}"
        "body{padding:16px;font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;"
        "overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>"
        f"</head><body>{clean}</body></html>"
    )
    return RenderResult(html=doc, blocked_remote_images=blocked[0], remote_images_loaded=allow_remote_images)
