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

    @property
    def cookie_secure(self) -> bool:
        return self.base_url.startswith("https://")


@lru_cache
def get_settings() -> Settings:
    return Settings()
