from __future__ import annotations

from app.mail.extract import extract_links, find_otp_codes
from app.mail.parser import parse_message, safe_filename

QP_LATIN1 = (
    b"From: =?ISO-8859-1?Q?Andr=E9?= <andre@origin.example>\r\n"
    b"To: box@test.example\r\n"
    b"Subject: =?UTF-8?B?w5xuaWPDtmRlIOKckw==?=\r\n"
    b"Date: Tue, 13 Oct 2026 09:30:00 +0200\r\n"
    b"Message-ID: <qp1@origin.example>\r\n"
    b"MIME-Version: 1.0\r\n"
    b"Content-Type: text/plain; charset=ISO-8859-1\r\n"
    b"Content-Transfer-Encoding: quoted-printable\r\n\r\n"
    b"Caf=E9 cr=E8me =\r\nsoft line break\r\n"
)

MULTIPART = b"""From: App <noreply@origin.example>
To: "Box One" <box@test.example>, other@elsewhere.example
Cc: cc@test.example
Subject: Multipart test
Date: not a real date
Message-ID: <mp1@origin.example>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="OUTER"

--OUTER
Content-Type: multipart/related; boundary="REL"

--REL
Content-Type: multipart/alternative; boundary="ALT"

--ALT
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: base64

SGVsbG8g8J+RiyB3b3JsZA==
--ALT
Content-Type: text/html; charset=utf-8

<p>Hello <b>world</b> <img src="cid:logo123@x"></p>
--ALT--
--REL
Content-Type: image/png
Content-ID: <logo123@x>
Content-Transfer-Encoding: base64

iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==
--REL--
--OUTER
Content-Type: application/pdf
Content-Disposition: attachment; filename*=UTF-8''r%C3%A9sum%C3%A9%20final.pdf
Content-Transfer-Encoding: base64

JVBERi0xLjQKJSVFT0YK
--OUTER
Content-Type: message/rfc822
Content-Disposition: attachment; filename="forwarded.eml"

From: inner@origin.example
To: someone@origin.example
Subject: Inner message

Inner body
--OUTER
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="../../etc/passwd"

cm9vdDp4OjA6MA==
--OUTER--
"""


def test_quoted_printable_latin1_and_encoded_headers():
    p = parse_message(QP_LATIN1)
    assert p.subject == "Ünicöde ✓"
    assert p.from_.name == "André"
    assert p.text_body.startswith("Café crème soft line break")
    assert p.sent_at.isoformat() == "2026-10-13T07:30:00+00:00"


def test_multipart_structure_attachments_and_inline():
    p = parse_message(MULTIPART.replace(b"\n", b"\r\n"))
    assert p.subject == "Multipart test"
    assert p.sent_at is None  # unparseable Date header must not crash
    assert [a.address for a in p.to] == ["box@test.example", "other@elsewhere.example"]
    assert p.to[0].name == "Box One"
    assert p.cc[0].address == "cc@test.example"
    assert p.text_body == "Hello 👋 world"
    assert "<b>world</b>" in p.html_body
    names = {a.filename: a for a in p.attachments}
    assert "résumé final.pdf" in names                      # RFC 2231 filename decoded
    assert names["résumé final.pdf"].data.startswith(b"%PDF")
    assert "forwarded.eml" in names and b"Inner body" in names["forwarded.eml"].data  # not walked into
    assert "passwd" in names                                 # path components stripped
    inline = [a for a in p.attachments if a.is_inline]
    assert len(inline) == 1 and inline[0].content_id == "<logo123@x>" and inline[0].content_type == "image/png"


def test_html_only_message_gets_text_fallback():
    raw = (b"From: a@origin.example\r\nTo: box@test.example\r\nSubject: html only\r\n"
           b"Content-Type: text/html; charset=utf-8\r\n\r\n"
           b"<html><head><style>p{color:red}</style></head><body><p>Line one</p><p>Line&nbsp;two &amp; more</p></body></html>")
    p = parse_message(raw)
    assert p.text_body == "Line one\n\nLine\xa0two & more" or p.text_body.replace("\xa0", " ") == "Line one\nLine two & more"
    assert "color:red" not in p.text_body


def test_unknown_charset_and_garbage_never_raise():
    raw = (b"From: broken\r\nTo: box@test.example\r\nSubject: =?x-unknown?Q?abc?=\r\n"
           b"Content-Type: text/plain; charset=x-totally-unknown\r\n\r\n\xff\xfe caf\xe9")
    p = parse_message(raw)
    assert "caf" in p.text_body
    p2 = parse_message(b"\x00\x01 not an email at all")
    assert p2.subject == ""


def test_safe_filename_rules():
    assert safe_filename("..\\..\\windows\\system32\\evil.dll") == "evil.dll"
    assert safe_filename("/etc/passwd") == "passwd"
    assert safe_filename("invoice‮fdp.exe") == "invoicefdp.exe"   # RTL override removed
    assert safe_filename("CON.txt") == "_CON.txt"
    assert safe_filename("a<b>c:d|e?.txt") == "a_b_c_d_e_.txt"
    assert safe_filename("", "application/pdf", 3) == "attachment-3.pdf"
    assert len(safe_filename("x" * 400 + ".pdf")) <= 180


def test_otp_detection_preserves_content():
    text = "Hello!\nYour verification code is 482913. It expires in 10 minutes. Order 2026 shipped. Ref 99."
    codes = find_otp_codes("Welcome", text)
    assert [c["code"] for c in codes] == ["482913"]
    assert "482913" in codes[0]["context"]
    assert find_otp_codes("Your login code: 123-456", "")[0]["code"] == "123456"
    assert find_otp_codes("Meeting at 2026 headquarters", "call 5551234 for info") == []
    assert find_otp_codes("", "Use security token AB12CD9 to continue")[0]["code"] == "AB12CD9"


def test_link_extraction():
    html = '<a href="https://ex.example/confirm?a=1&amp;b=2">Confirm</a> <a href="javascript:alert(1)">x</a>'
    text = "Or visit https://ex.example/help. Mail us: mailto:help@ex.example"
    links = extract_links(html, text)
    urls = [link["url"] for link in links]
    assert urls[0] == "https://ex.example/confirm?a=1&b=2" and links[0]["text"] == "Confirm"
    assert "https://ex.example/help" in urls
    assert "mailto:help@ex.example" in urls
    assert not any(u.startswith("javascript") for u in urls)
