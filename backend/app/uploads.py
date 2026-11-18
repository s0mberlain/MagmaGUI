"""Helpers shared by the evidence uploads (interview evidence, purple team test evidence).

All evidence files are kept in the database and count against one limit,
EVIDENCE_MAX_TOTAL_MB (issue #47).
"""

import re
import unicodedata
from urllib.parse import quote

from sqlalchemy import func, select

from app.models import InterviewAttachment, PtAttachment

_UNSAFE = re.compile(r"[^A-Za-z0-9._ -]")


def ext(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def safe_name(name: str) -> str:
    """The file name as shown and offered for download: no path, no control characters."""
    name = unicodedata.normalize("NFC", name).replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C").strip(" .")
    if len(name) > 200:
        stem, _, e = name.rpartition(".")
        name = stem[: 200 - len(e) - 1] + "." + e
    return name


def text_start(data: bytes) -> str:
    """The start of a text file without byte order mark and leading white space."""
    head = data[:4096]
    if head.startswith((b"\xff\xfe", b"\xfe\xff")):  # UTF-16 (Threat Modeling Tool)
        text = head.decode("utf-16", "ignore")
    else:
        text = head.decode("utf-8-sig", "ignore")
    return text.lstrip()


def content_disposition(filename: str, inline: bool, fallback: str = "evidence") -> str:
    ascii_name = _UNSAFE.sub("_", filename) or fallback
    return (
        f'{"inline" if inline else "attachment"}; filename="{ascii_name}"; '
        f"filename*=UTF-8''{quote(filename)}"
    )


# shown inside the app (same origin) but never able to run anything
SAFE_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; "
    "style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'self'",
    "X-Frame-Options": "SAMEORIGIN",
    "Cache-Control": "private, no-store",
}


def used_bytes(db) -> int:
    """Space used by all evidence files together."""
    total = 0
    for model in (InterviewAttachment, PtAttachment):
        total += int(db.scalar(select(func.coalesce(func.sum(model.size), 0))) or 0)
    return total


def file_count(db) -> int:
    return sum(
        int(db.scalar(select(func.count(m.id))) or 0) for m in (InterviewAttachment, PtAttachment)
    )
