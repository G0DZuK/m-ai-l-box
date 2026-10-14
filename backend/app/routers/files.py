from __future__ import annotations

import hashlib
import re
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import require_user
from ..mail.parser import safe_filename, sniff_previewable
from ..models import StoredFile, User
from ..ratelimit import enforce
from ..scanning import scan_bytes
from ..schemas import DownloadLink, FileOut, RenameFileIn, file_out
from ..services import _safe_delete, user_quota, user_usage
from ..storage import get_storage
from .attachments import _link

router = APIRouter(prefix="/api/files", tags=["personal files"])
_CT_RE = re.compile(r"^[a-z0-9!#$&^_.+-]{1,64}/[a-z0-9!#$&^_.+-]{1,128}$")


def _get_file(db: Session, user: User, file_id: uuid.UUID) -> StoredFile:
    f = db.get(StoredFile, file_id)
    if f is None or f.user_id != user.id:
        raise HTTPException(404, "File not found")
    return f


@router.get("")
def list_files(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
    q: str | None = Query(None, max_length=200),
    sort: str = Query("created", pattern="^(created|name|size|type)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
):
    query = select(StoredFile).where(StoredFile.user_id == user.id)
    if q:
        query = query.where(func.lower(StoredFile.filename).contains(q.strip().lower(), autoescape=True))
    col = {"created": StoredFile.created_at, "name": func.lower(StoredFile.filename),
           "size": StoredFile.size_bytes, "type": StoredFile.content_type}[sort]
    query = query.order_by(col.desc() if order == "desc" else col.asc()).limit(1000)
    return {"items": [file_out(f) for f in db.scalars(query)], "next_cursor": None}


@router.post("", status_code=201, response_model=FileOut)
def upload(request: Request, file: UploadFile = File(...), user: User = Depends(require_user),
                 db: Session = Depends(get_db)):
    s = get_settings()
    enforce(f"upload:{user.id}", s.rl_upload_per_hour, 3600, "Too many uploads")
    declared = int(request.headers.get("content-length") or 0)
    if declared > s.max_upload_bytes + 64 * 1024:
        raise HTTPException(413, f"File is too large. The limit is {s.max_upload_bytes // (1024 * 1024)} MB.")

    sha = hashlib.sha256()
    size = 0
    head = b""
    while chunk := file.file.read(1024 * 1024):
        if not head:
            head = chunk[:16]
        size += len(chunk)
        if size > s.max_upload_bytes:
            raise HTTPException(413, f"File is too large. The limit is {s.max_upload_bytes // (1024 * 1024)} MB.")
        sha.update(chunk)
    if size == 0:
        raise HTTPException(422, "The file is empty.")
    if user_usage(db, user.id)["used_bytes"] + size > user_quota(user):
        raise HTTPException(507, "Not enough storage left in your account. Delete some files and try again.")

    file.file.seek(0)
    status = "not_scanned"
    if s.scanner != "none":
        status = scan_bytes(file.file.read())
        file.file.seek(0)
    ctype = (file.content_type or "application/octet-stream").lower()
    if not _CT_RE.match(ctype):
        ctype = "application/octet-stream"
    fid = uuid.uuid4()
    key = f"files/{user.id}/{fid}"
    get_storage().put_file(key, file.file, "application/octet-stream")
    sniff = sniff_previewable(head)
    f = StoredFile(id=fid, user_id=user.id, filename=safe_filename(file.filename, ctype), content_type=ctype,
                   size_bytes=size, sha256=sha.hexdigest(), storage_key=key, source="upload", scan_status=status,
                   preview_kind=sniff[0] if sniff else None)
    db.add(f)
    db.commit()
    return file_out(f)


@router.patch("/{file_id}", response_model=FileOut)
def rename(file_id: uuid.UUID, body: RenameFileIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    f = _get_file(db, user, file_id)
    f.filename = safe_filename(body.filename, f.content_type)
    db.commit()
    return file_out(f)


@router.post("/{file_id}/download-link", response_model=DownloadLink)
def file_link(file_id: uuid.UUID, disposition: str = Query("attachment", pattern="^(attachment|inline)$"),
              user: User = Depends(require_user), db: Session = Depends(get_db)):
    f = _get_file(db, user, file_id)
    return _link(f.storage_key, f.filename, f.content_type, disposition, f.preview_kind, f.scan_status)


@router.delete("/{file_id}", status_code=204)
def delete_file(file_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
    f = _get_file(db, user, file_id)
    key = f.storage_key
    db.delete(f)
    db.commit()
    _safe_delete(key)
    return Response(status_code=204)
