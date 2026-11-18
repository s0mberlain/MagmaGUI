"""Red team accounts (PROJ-3): what they may call and when they expire.

A red team account is a local account of an external tester. It may only use the campaign API
(for the campaigns it is assigned to) and its own account. It expires at the end of its expiry
date in the server time zone; without a manual date the expiry date is the latest planned end of
its assigned campaigns + 7 days.
"""

import logging
import re
import threading
from datetime import date, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from app import audit
from app.models import Campaign, Role, User, UserSession, campaign_red_team

log = logging.getLogger(__name__)

EXPIRY_GRACE_DAYS = 7

# Everything a red team account may call; every other API path is refused (deny by default).
_ALLOWED = re.compile(r"^/api/(auth/.*|campaigns(/.*)?|campaign-tests/.*)$")

NO_CAMPAIGN = "This red team account has no campaign and no expiry date"
EXPIRED = "This account has expired"


def path_allowed(path: str) -> bool:
    return bool(_ALLOWED.match(path))


def today() -> date:
    return date.today()  # server time zone, as the spec says


def is_expired(user: User, on: date | None = None) -> bool:
    return user.expires_on is not None and (on or today()) > user.expires_on


def login_refusal(user: User) -> str | None:
    """Why a red team account cannot sign in now (None = it can)."""
    if user.role != Role.red_team:
        return None
    if user.expires_on is None:
        return NO_CAMPAIGN
    if is_expired(user):
        return EXPIRED
    return None


def auto_expiry(db: Session, user: User) -> date | None:
    end = db.scalar(
        select(func.max(Campaign.planned_end))
        .join(campaign_red_team, campaign_red_team.c.campaign_id == Campaign.id)
        .where(campaign_red_team.c.user_id == user.id)
    )
    return end + timedelta(days=EXPIRY_GRACE_DAYS) if end else None


def recompute(db: Session, actor: User | None, users: list[User]) -> None:
    """Recalculate the automatic expiry date of these accounts (after an assignment or a planned
    end changed). Manual dates stay."""
    db.flush()
    for u in users:
        if u.role != Role.red_team or u.expiry_manual:
            continue
        new = auto_expiry(db, u)
        if new != u.expires_on:
            audit.record(
                db, actor, "expiry", "user", u.username, {"expires_on": [u.expires_on, new]}
            )
            u.expires_on = new


def expire(db: Session, user: User) -> None:
    """Disable an expired account and end its sessions (the caller commits)."""
    user.active = False
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    audit.record(db, None, "expire", "user", user.username, {"expires_on": user.expires_on})


def sweep(db: Session) -> int:
    """Disable all red team accounts whose expiry date has passed."""
    n = 0
    for u in db.scalars(
        select(User).where(
            User.role == Role.red_team,
            User.active,
            User.expires_on.is_not(None),
            User.expires_on < today(),
        )
    ):
        expire(db, u)
        n += 1
    if n:
        db.commit()
        log.info("Disabled %d expired red team account(s)", n)
    return n


class Sweeper:
    """Background thread that disables expired red team accounts (checked every 10 minutes).
    Requests of an expired account are refused anyway (app/security.py)."""

    def __init__(self, factory: sessionmaker):
        self.factory = factory
        self._stop = threading.Event()

    def start(self) -> None:
        threading.Thread(target=self._loop, name="redteam-expiry", daemon=True).start()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                with self.factory() as db:
                    sweep(db)
            except Exception:
                log.exception("Red team expiry check failed")
            self._stop.wait(600)

    def stop(self) -> None:
        self._stop.set()
