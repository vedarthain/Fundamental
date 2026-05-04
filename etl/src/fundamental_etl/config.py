"""Runtime config loaded from .env.local."""
from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]
ENV_FILE = REPO_ROOT / ".env.local"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    screener_sessionid: str
    screener_csrftoken: str
    golden_db_url: str
    app_db_url: str
    anthropic_api_key: str = ""

    # ETL knobs
    screener_throttle_seconds: float = Field(default=2.0)
    screener_max_retries: int = Field(default=3)
    screener_user_agent: str = Field(
        default="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 NSE-Platform-ETL"
    )


settings = Settings()  # type: ignore[call-arg]
