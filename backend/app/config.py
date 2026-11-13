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


@lru_cache
def get_settings() -> Settings:
    return Settings()
