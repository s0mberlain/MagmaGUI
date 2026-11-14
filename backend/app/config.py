from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from environment variables (see .env.example)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Magma UCF"
    database_url: str = "sqlite:////data/magma.db"
    # PostgreSQL connection pool and limits (ignored for SQLite).
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_recycle: int = 1800
    db_statement_timeout_ms: int = 0
    # How long startup waits for the database to accept connections.
    db_wait_seconds: int = 60
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

    # Target implementation per risk level when a use case sets no own target (app/growth.py).
    risk_targets: str = "1=0.4,2=0.5,3=0.6,4=0.75,5=0.9"

    # Fill the catalogue with generated demo data on first start (see app/demo.py).
    demo_data: bool = False
    demo_seed: int = 42

    # Automatic snapshots for trend charts: off | daily | weekly | monthly (app/snapshots.py).
    snapshot_schedule: str = "monthly"

    # Optional git repository for the YAML configs (app/gitsync.py). Off when the URL is empty.
    git_remote_url: str = ""
    git_branch: str = "main"
    git_username: str = "magma"
    git_token: str | None = None
    git_ssh_key_file: str | None = None
    git_workdir: Path = Path("/data/git-repo")
    git_author_email_domain: str = "magma.local"
    # Push automatically after each config commit and tag (in the background).
    git_auto_sync: bool = True

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
    def risk_target_map(self) -> dict[int, float]:
        from app.growth import parse_risk_targets

        return parse_risk_targets(self.risk_targets)

    @property
    def git_enabled(self) -> bool:
        return bool(self.git_remote_url)

    @property
    def cookie_secure(self) -> bool:
        return self.base_url.startswith("https://")


@lru_cache
def get_settings() -> Settings:
    return Settings()
