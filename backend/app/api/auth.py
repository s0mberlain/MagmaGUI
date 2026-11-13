from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from app import audit
from app.api.deps import DB, SettingsDep
from app.models import AuthSource, User
from app.schemas import AuthConfigOut, LoginIn, PasswordChange, UserOut
from app.security import (
    SESSION_COOKIE,
    CurrentUser,
    as_utc,
    check_password_policy,
    create_session,
    drop_session,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# Verified against when the username does not exist, so timing does not reveal valid names.
_DUMMY_HASH = hash_password("timing-equaliser-not-a-password")


@router.get("/config", response_model=AuthConfigOut)
def auth_config(settings: SettingsDep) -> AuthConfigOut:
    return AuthConfigOut(
        local_login_enabled=settings.local_login_enabled,
        sso_enabled=settings.sso_enabled,
        sso_label=settings.oidc_button_label,
    )


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, response: Response, db: DB, settings: SettingsDep) -> User:
    if not settings.local_login_enabled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Local login is disabled")
    invalid = HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")
    user = db.scalar(select(User).where(User.username == body.username))
    now = datetime.now(UTC)

    if user is None or user.auth_source != AuthSource.local:
        verify_password(_DUMMY_HASH, body.password)
        raise invalid
    if user.locked_until and as_utc(user.locked_until) > now:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Account temporarily locked, try again later"
        )
    if not verify_password(user.password_hash, body.password) or not user.active:
        user.failed_logins += 1
        if user.failed_logins >= settings.max_failed_logins:
            user.locked_until = now + timedelta(minutes=settings.lockout_minutes)
            user.failed_logins = 0
            audit.record(db, user, "lockout", "user", user.username)
        db.commit()
        raise invalid

    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    token = create_session(db, user, settings)
    audit.record(db, user, "login", "user", user.username)
    db.commit()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: DB) -> None:
    drop_session(db, request.cookies.get(SESSION_COOKIE))
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: PasswordChange, user: CurrentUser, db: DB) -> None:
    if user.auth_source != AuthSource.local:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "SSO accounts have no local password")
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is wrong")
    check_password_policy(body.new_password)
    user.password_hash = hash_password(body.new_password)
    audit.record(db, user, "password_change", "user", user.username)
    db.commit()
