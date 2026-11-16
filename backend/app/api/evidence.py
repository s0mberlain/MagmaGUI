"""Evidence files on business owner interviews (issue #34).

Accepted: PDF, JPEG/PNG images, diagrams (Visio .vsd/.vsdx, Dia .dia, Excalidraw .excalidraw)
and Microsoft Threat Modeling Tool files (.tm7). The extension decides the type; the first bytes
must fit it, so a renamed file of another kind is refused. PDFs and images can be shown in the
app (served inline); every other type is only offered as a download.

Files can be added and removed while the interview is a draft; a completed interview keeps its
evidence as it was (read-only, like the rest of the interview).
"""

import hashlib
import json
import re
import unicodedata
from datetime import datetime
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel

from app import audit
from app.api.deps import DB
from app.models import Interview, InterviewAttachment, InterviewStatus
from app.security import Editor, Reader

router = APIRouter(tags=["systems & interviews"])

MAX_FILE = 20 * 1024 * 1024
MAX_FILES = 50

ZIP = (b"PK\x03\x04",)
OLE = (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",)

# extension -> (content type, magic prefixes or a check name, viewable in the app)
TYPES: dict[str, tuple[str, tuple[bytes, ...] | str, bool]] = {
    "pdf": ("application/pdf", (b"%PDF-",), True),
    "png": ("image/png", (b"\x89PNG\r\n\x1a\n",), True),
    "jpg": ("image/jpeg", (b"\xff\xd8\xff",), True),
    "jpeg": ("image/jpeg", (b"\xff\xd8\xff",), True),
    "vsdx": ("application/vnd.ms-visio.drawing", ZIP, False),
    "vsd": ("application/vnd.visio", OLE, False),
    # Dia saves gzip-compressed XML by default, uncompressed XML on request
    "dia": ("application/x-dia-diagram", "dia", False),
    "excalidraw": ("application/vnd.excalidraw+json", "json", False),
    "tm7": ("application/vnd.ms-threatmodel+xml", "xml", False),
}
ACCEPT = sorted(TYPES)


class AttachmentOut(BaseModel):
    id: int
    interview_id: int
    filename: str
    content_type: str
    size: int
    sha256: str
    uploaded_by: str
    uploaded_at: datetime
    viewable: bool
    kind: Literal["pdf", "image", "diagram", "threat_model"]


def _ext(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def _kind(ext: str) -> str:
    if ext == "pdf":
        return "pdf"
    if ext in ("png", "jpg", "jpeg"):
        return "image"
    if ext == "tm7":
        return "threat_model"
    return "diagram"


def out(a: InterviewAttachment) -> AttachmentOut:
    ext = _ext(a.filename)
    return AttachmentOut(
        id=a.id,
        interview_id=a.interview_id,
        filename=a.filename,
        content_type=a.content_type,
        size=a.size,
        sha256=a.sha256,
        uploaded_by=a.uploaded_by,
        uploaded_at=a.uploaded_at,
        viewable=TYPES.get(ext, ("", (), False))[2],
        kind=_kind(ext),  # type: ignore[arg-type]
    )


def _text_start(data: bytes) -> str:
    """The start of a text file without byte order mark and leading white space."""
    head = data[:4096]
    if head.startswith((b"\xff\xfe", b"\xfe\xff")):  # UTF-16 (Threat Modeling Tool)
        text = head.decode("utf-16", "ignore")
    else:
        text = head.decode("utf-8-sig", "ignore")
    return text.lstrip()


def _content_ok(ext: str, data: bytes) -> bool:
    check = TYPES[ext][1]
    if isinstance(check, tuple):
        return data.startswith(check)
    if check == "dia":
        return data.startswith(b"\x1f\x8b") or _text_start(data).startswith("<")
    if check == "xml":
        return _text_start(data).startswith("<")
    if check == "json":
        try:
            doc = json.loads(data.decode("utf-8-sig"))
        except (UnicodeDecodeError, ValueError):
            return False
        return isinstance(doc, dict)
    return False  # pragma: no cover


def _safe_name(name: str) -> str:
    """The file name as shown and offered for download: no path, no control characters."""
    name = unicodedata.normalize("NFC", name).replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C").strip(" .")
    if len(name) > 200:
        stem, _, ext = name.rpartition(".")
        name = stem[: 200 - len(ext) - 1] + "." + ext
    return name


def _interview(db, interview_id: int) -> Interview:
    i = db.get(Interview, interview_id)
    if i is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Interview not found")
    return i


def _attachment(db, attachment_id: int) -> InterviewAttachment:
    a = db.get(InterviewAttachment, attachment_id)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    return a


def _key(i: Interview) -> str:
    return f"{i.system.name} {i.interview_date.isoformat()}"


@router.get("/interviews/{interview_id}/attachments", response_model=list[AttachmentOut])
def list_attachments(interview_id: int, _: Reader, db: DB) -> list[AttachmentOut]:
    return [out(a) for a in _interview(db, interview_id).attachments]


@router.post(
    "/interviews/{interview_id}/attachments", response_model=AttachmentOut, status_code=201
)
async def upload_attachment(
    interview_id: int, user: Editor, db: DB, file: UploadFile = File(...)
) -> AttachmentOut:
    i = _interview(db, interview_id)
    if i.status != InterviewStatus.draft:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Evidence can only be added while the interview is a draft"
        )
    name = _safe_name(file.filename or "")
    ext = _ext(name)
    if ext not in TYPES or not name[: -len(ext) - 1]:
        raise HTTPException(
            422,
            "This file type is not accepted. Allowed: PDF, JPG, PNG, Visio (.vsd, .vsdx), "
            "Dia, Excalidraw and Threat Modeling Tool (.tm7) files",
        )
    data = await file.read(MAX_FILE + 1)
    if len(data) > MAX_FILE:
        raise HTTPException(413, "The file is larger than 20 MB")
    if not data:
        raise HTTPException(422, "The file is empty")
    if not _content_ok(ext, data):
        raise HTTPException(422, f"The file content does not match a .{ext} file")
    if len(i.attachments) >= MAX_FILES:
        raise HTTPException(422, f"An interview can have at most {MAX_FILES} files")
    a = InterviewAttachment(
        interview_id=i.id,
        filename=name,
        content_type=TYPES[ext][0],
        size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        data=data,
        uploaded_by=user.username,
    )
    db.add(a)
    audit.record(
        db, user, "upload", "interview_evidence", _key(i), {"file": name, "size": len(data)}
    )
    db.commit()
    return out(a)


_UNSAFE = re.compile(r"[^A-Za-z0-9._ -]")


@router.get("/interview-attachments/{attachment_id}/content")
def attachment_content(attachment_id: int, _: Reader, db: DB, download: bool = False) -> Response:
    a = _attachment(db, attachment_id)
    viewable = TYPES.get(_ext(a.filename), ("", (), False))[2]
    inline = viewable and not download
    ascii_name = _UNSAFE.sub("_", a.filename) or "evidence"
    disposition = (
        f'{"inline" if inline else "attachment"}; filename="{ascii_name}"; '
        f"filename*=UTF-8''{quote(a.filename)}"
    )
    return Response(
        a.data,
        media_type=a.content_type if viewable else "application/octet-stream",
        headers={
            "Content-Disposition": disposition,
            # shown inside the interview page (same origin) but never able to run anything
            "Content-Security-Policy": "default-src 'none'; img-src 'self'; "
            "style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'self'",
            "X-Frame-Options": "SAMEORIGIN",
            "Cache-Control": "private, no-store",
        },
    )


@router.delete("/interview-attachments/{attachment_id}", status_code=204)
def delete_attachment(attachment_id: int, user: Editor, db: DB) -> None:
    a = _attachment(db, attachment_id)
    i = a.interview
    if i.status != InterviewStatus.draft:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Evidence of a completed interview cannot be removed",
        )
    audit.record(db, user, "delete", "interview_evidence", _key(i), {"file": a.filename})
    db.delete(a)
    db.commit()
