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
    # Throttle = pause between successive Screener calls. We lowered from
    # 2.0 → 1.0 after confirming the persistent httpx.Client cuts overhead
    # and Screener tolerates ~1 req/s without rate-limiting. Halves the
    # full-universe scrape (~72 min → ~36 min). Override via env if Screener
    # starts pushing back: SCREENER_THROTTLE_SECONDS=2.0
    screener_throttle_seconds: float = Field(default=1.0)
    screener_max_retries: int = Field(default=3)
    # Plain Chrome-on-macOS User-Agent. Earlier UA had "NSE-Platform-ETL"
    # suffix as a be-a-good-citizen self-identification — Screener's bot
    # detector flagged that and rate-limited us aggressively (429s) even
    # with valid session cookies. A plain browser UA gets the same limits
    # the user's browser gets. Override via SCREENER_USER_AGENT if you
    # need a different fingerprint.
    screener_user_agent: str = Field(
        default=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
    )


settings = Settings()  # type: ignore[call-arg]
