from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from environment variables (see .env.example)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Magma UCF"
    database_url: str = "sqlite:////data/magma.db"
    secret_key: str = "change-me"
    base_url: str = "http://localhost:8080"
    # Directory with the built frontend (index.html + assets). Empty or missing = API only.
    static_dir: Path = Path(__file__).resolve().parent.parent / "static"

    # Run migrations and seed the catalogue on startup.
    auto_migrate: bool = True

    # First admin account, created when the user table is empty.
    admin_user: str = "admin"
    admin_password: str | None = None

    local_login_enabled: bool = True
    session_hours: int = 12
    max_failed_logins: int = 5
    lockout_minutes: int = 15
    min_password_length: int = 12

    # Verification interval used when a rule has no own interval.
    default_verification_days: int = 180

    # Fill the catalogue with generated demo data on first start (see app/demo.py).
    demo_data: bool = False
    demo_seed: int = 42

    # SSO via OpenID Connect (see app/oidc.py). Enabled when issuer and client id are set.
    oidc_issuer: str | None = None
    oidc_client_id: str | None = None
    oidc_client_secret: str | None = None
    oidc_scopes: str = "openid profile email"
    # Claim with the user's groups or roles, e.g. "groups" or "roles".
    oidc_role_claim: str = "groups"
    # IdP group -> app role, e.g. "SOC-Admins=admin,SOC-Analysts=analyst,Audit=auditor".
    oidc_role_map: str = ""
    # Role for users without a matching group; empty = no access.
    oidc_default_role: str | None = None
    oidc_username_claim: str = "preferred_username"
    oidc_button_label: str = "Sign in with SSO"

    @property
    def sso_enabled(self) -> bool:
        return bool(self.oidc_issuer and self.oidc_client_id)

    @property
    def cookie_secure(self) -> bool:
        return self.base_url.startswith("https://")


@lru_cache
def get_settings() -> Settings:
    return Settings()
