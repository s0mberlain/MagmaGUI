from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select

from app import audit, totp
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

TOTP_REQUIRED = "totp_required"

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

    def fail(exc: HTTPException) -> HTTPException:
        user.failed_logins += 1
        if user.failed_logins >= settings.max_failed_logins:
            user.locked_until = now + timedelta(minutes=settings.lockout_minutes)
            user.failed_logins = 0
            audit.record(db, user, "lockout", "user", user.username)
        db.commit()
        return exc

    if not verify_password(user.password_hash, body.password) or not user.active:
        raise fail(invalid)
    if user.totp_enabled:
        if not body.otp:
            # password was right: ask for the second factor (does not count as a failure)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, TOTP_REQUIRED)
        how = _check_second_factor(user, body.otp, settings)
        if how is None:
            raise fail(HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid authentication code"))
        if how == "recovery":
            audit.record(
                db,
                user,
                "recovery_code_used",
                "user",
                user.username,
                {"left": len(user.recovery_codes)},
            )

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


# ---------------------------------------------------------------- two-factor login (TOTP)


def _check_second_factor(user: User, code: str, settings) -> str | None:
    """'totp' or 'recovery' when the code is valid (and consumes it), else None."""
    secret = totp.decrypt(user.totp_secret or "", settings.secret_key)
    if secret:
        step = totp.verify(secret, code, user.totp_last_step)
        if step is not None:
            user.totp_last_step = step
            return "totp"
    h = totp.hash_code(code)
    if h in (user.recovery_codes or []):
        user.recovery_codes = [c for c in user.recovery_codes if c != h]
        return "recovery"
    return None


class TotpPassword(BaseModel):
    password: str


class TotpCode(BaseModel):
    code: str


class TotpConfirm(BaseModel):
    password: str
    code: str


class TotpSetupOut(BaseModel):
    secret: str
    uri: str
    qr_svg: str


class RecoveryOut(BaseModel):
    recovery_codes: list[str]


def _local(user: User) -> None:
    if user.auth_source != AuthSource.local:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "SSO accounts use the second factor of the identity provider",
        )


@router.post("/me/totp/setup", response_model=TotpSetupOut)
def totp_setup(
    body: TotpPassword, user: CurrentUser, db: DB, settings: SettingsDep
) -> TotpSetupOut:
    """Start setting up an authenticator app; nothing changes for login until it is confirmed."""
    _local(user)
    if user.totp_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-factor login is already on")
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password is wrong")
    secret = totp.new_secret()
    user.totp_secret = totp.encrypt(secret, settings.secret_key)
    user.totp_last_step = None
    db.commit()
    uri = totp.otpauth_uri(secret, user.username, settings.app_name)
    return TotpSetupOut(secret=secret, uri=uri, qr_svg=totp.qr_svg(uri))


@router.post("/me/totp/enable", response_model=RecoveryOut)
def totp_enable(body: TotpCode, user: CurrentUser, db: DB, settings: SettingsDep) -> RecoveryOut:
    _local(user)
    if user.totp_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-factor login is already on")
    secret = totp.decrypt(user.totp_secret or "", settings.secret_key)
    if not secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Start the setup first")
    step = totp.verify(secret, body.code, None)
    if step is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "The code does not match, check the time on your phone"
        )
    codes = totp.new_recovery_codes()
    user.totp_enabled = True
    user.totp_last_step = step
    user.recovery_codes = [totp.hash_code(c) for c in codes]
    audit.record(db, user, "totp_enable", "user", user.username)
    db.commit()
    return RecoveryOut(recovery_codes=codes)


def _confirm(user: User, body: TotpConfirm, settings) -> None:
    _local(user)
    if not user.totp_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-factor login is off")
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password is wrong")
    if _check_second_factor(user, body.code, settings) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid authentication code")


@router.post("/me/totp/disable", status_code=status.HTTP_204_NO_CONTENT)
def totp_disable(body: TotpConfirm, user: CurrentUser, db: DB, settings: SettingsDep) -> None:
    _confirm(user, body, settings)
    clear_totp(user)
    audit.record(db, user, "totp_disable", "user", user.username)
    db.commit()


@router.post("/me/totp/recovery-codes", response_model=RecoveryOut)
def totp_new_codes(
    body: TotpConfirm, user: CurrentUser, db: DB, settings: SettingsDep
) -> RecoveryOut:
    _confirm(user, body, settings)
    codes = totp.new_recovery_codes()
    user.recovery_codes = [totp.hash_code(c) for c in codes]
    audit.record(db, user, "recovery_codes_renewed", "user", user.username)
    db.commit()
    return RecoveryOut(recovery_codes=codes)


def clear_totp(user: User) -> None:
    user.totp_enabled = False
    user.totp_secret = None
    user.totp_last_step = None
    user.recovery_codes = []
