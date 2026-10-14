from __future__ import annotations

import base64
import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import Principal, get_principal, mailbox_dep
from ..mail.parser import sniff_previewable
from ..models import Attachment, Mailbox, Message, StoredFile
from ..schemas import AttachmentListItem, DownloadLink, FileOut, addr, attachment_out, file_out
from ..security import make_download_token, read_download_token
from ..services import user_quota, user_usage
from ..storage import StorageError, get_storage

router = APIRouter(prefix="/api", tags=["attachments"])


def _get_attachment(db: Session, mb: Mailbox, attachment_id: uuid.UUID) -> Attachment:
    a = db.get(Attachment, attachment_id)
    if a is None or a.mailbox_id != mb.id:
        raise HTTPException(404, "Attachment not found")
    return a


def _link(storage_key: str, filename: str, content_type: str, disposition: str, preview_kind: str | None,
          scan_status: str) -> DownloadLink:
    if scan_status == "infected":
        raise HTTPException(403, "This file was flagged by the malware scanner and cannot be downloaded.")
    if disposition == "inline" and preview_kind not in ("image", "pdf"):
        raise HTTPException(422, "This file type cannot be previewed safely. Download it instead.")
    token = make_download_token(storage_key, filename, content_type, disposition)
    return DownloadLink(url=f"/api/download/{token}", expires_in=get_settings().download_link_ttl_seconds)


@router.get("/mailboxes/{mailbox_id}/attachments")
def list_attachments(
    mb: Mailbox = Depends(mailbox_dep("attachments:read")),
    db: Session = Depends(get_db),
    q: str | None = Query(None, max_length=200),
    sort: str = Query("received", pattern="^(received|name|size|type)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    include_inline: bool = False,
    limit: int = Query(100, ge=1, le=200),
    cursor: str | None = None,
):
    query = (
        select(Attachment, Message)
        .join(Message, Message.id == Attachment.message_id)
        .where(Attachment.mailbox_id == mb.id, Message.deleted_at.is_(None))
    )
    if not include_inline:
        query = query.where(Attachment.is_inline.is_(False))
    if q:
        term = q.strip().lower()
        query = query.where(or_(
            func.lower(Attachment.filename).contains(term, autoescape=True),
            func.lower(Message.subject).contains(term, autoescape=True),
            func.lower(Message.from_address).contains(term, autoescape=True),
            func.lower(Message.from_name).contains(term, autoescape=True),
        ))
    col = {"received": Message.received_at, "name": func.lower(Attachment.filename),
           "size": Attachment.size_bytes, "type": Attachment.content_type}[sort]
    query = query.order_by(col.desc() if order == "desc" else col.asc(), Attachment.id)
    offset = 0
    if cursor:
        try:
            offset = int(base64.urlsafe_b64decode(cursor.encode()).decode())
        except Exception:
            raise HTTPException(400, "Invalid cursor")
    rows = list(db.execute(query.offset(offset).limit(limit + 1)))
    items = [
        AttachmentListItem(
            **attachment_out(a).model_dump(),
            message_subject=m.subject, message_from=addr(m.from_name, m.from_address), received_at=m.received_at,
        )
        for a, m in rows[:limit]
    ]
    nxt = base64.urlsafe_b64encode(str(offset + limit).encode()).decode() if len(rows) > limit else None
    return {"items": items, "next_cursor": nxt}


@router.post("/mailboxes/{mailbox_id}/attachments/{attachment_id}/download-link", response_model=DownloadLink)
def attachment_link(
    attachment_id: uuid.UUID,
    disposition: str = Query("attachment", pattern="^(attachment|inline)$"),
    mb: Mailbox = Depends(mailbox_dep("attachments:read")),
    db: Session = Depends(get_db),
):
    a = _get_attachment(db, mb, attachment_id)
    return _link(a.storage_key, a.filename, a.content_type, disposition, a.preview_kind, a.scan_status)


@router.post("/mailboxes/{mailbox_id}/attachments/{attachment_id}/save-to-files", status_code=201, response_model=FileOut)
def save_to_files(
    attachment_id: uuid.UUID,
    p: Principal = Depends(get_principal),
    mb: Mailbox = Depends(mailbox_dep("attachments:read")),
    db: Session = Depends(get_db),
):
    if p.user is None:
        raise HTTPException(401, "Sign in to save files to your account.")
    a = _get_attachment(db, mb, attachment_id)
    if a.scan_status == "infected":
        raise HTTPException(403, "This file was flagged by the malware scanner and cannot be saved.")
    if user_usage(db, p.user.id)["used_bytes"] + a.size_bytes > user_quota(p.user):
        raise HTTPException(507, "Not enough storage left in your account. Delete some files and try again.")
    fid = uuid.uuid4()
    key = f"files/{p.user.id}/{fid}"
    get_storage().copy(a.storage_key, key)
    f = StoredFile(id=fid, user_id=p.user.id, filename=a.filename, content_type=a.content_type, size_bytes=a.size_bytes,
                   sha256=a.sha256, storage_key=key, source="attachment", scan_status=a.scan_status,
                   preview_kind=a.preview_kind)
    db.add(f)
    db.commit()
    return file_out(f)


def content_disposition(disposition: str, filename: str) -> str:
    ascii_name = filename.encode("ascii", "ignore").decode().replace('"', "").replace("\\", "") or "download"
    return f"{disposition}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename, safe='')}"


@router.get("/download/{token}", summary="Download via a short-lived signed link", include_in_schema=True)
def download(token: str):
    data = read_download_token(token)
    if data is None:
        raise HTTPException(410, "This download link has expired. Go back and click Download again.")
    storage = get_storage()
    try:
        chunks = storage.iter_chunks(data["k"])
        first = next(chunks, b"")
    except StorageError:
        raise HTTPException(404, "File not found")

    disposition = data.get("d", "attachment")
    headers = {
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "private, no-store",
        "Cross-Origin-Resource-Policy": "same-origin",
    }
    media_type = "application/octet-stream"
    if data.get("t") == "message/rfc822" and disposition == "attachment":
        media_type = "message/rfc822"
    if disposition == "inline":
        sniff = sniff_previewable(first[:16])
        if sniff is None:
            disposition = "attachment"
        else:
            media_type = sniff[1]
            if sniff[0] == "image":
                headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src 'self'; frame-ancestors 'self'"
            else:  # PDFs: browsers' built-in viewers refuse to run under CSP sandbox
                headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'self'"
            headers["X-Frame-Options"] = "SAMEORIGIN"
    if disposition == "attachment":
        headers["Content-Security-Policy"] = "sandbox; default-src 'none'"
    headers["Content-Disposition"] = content_disposition(disposition, data.get("n") or "download")

    def body():
        yield first
        yield from chunks

    return StreamingResponse(body(), media_type=media_type, headers=headers)
