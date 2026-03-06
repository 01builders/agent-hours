"""
Configuration loader for Mark.
Reads .env file and provides typed access to all settings.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Find project root (where .env lives)
PROJECT_ROOT = Path(__file__).parent.parent
load_dotenv(PROJECT_ROOT / ".env")


class Config:
    """Central configuration — all settings in one place."""

    # Email / IMAP
    IMAP_SERVER: str = os.getenv("IMAP_SERVER", "imap.gmail.com")
    IMAP_PORT: int = int(os.getenv("IMAP_PORT", "993"))
    IMAP_EMAIL: str = os.getenv("IMAP_EMAIL", "")
    IMAP_PASSWORD: str = os.getenv("IMAP_PASSWORD", "")

    # Anthropic
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")

    # Database
    DATABASE_PATH: str = os.getenv("DATABASE_PATH", "data/mark.db")
    DATABASE_URL: str = f"sqlite:///{PROJECT_ROOT / DATABASE_PATH}"

    # Processing
    MAX_LINKS_PER_RUN: int = int(os.getenv("MAX_LINKS_PER_RUN", "30"))
    API_CALL_DELAY: float = float(os.getenv("API_CALL_DELAY", "1.5"))
    INITIAL_INGEST_DAYS: int = int(os.getenv("INITIAL_INGEST_DAYS", "30"))

    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    LOG_FILE: str = os.getenv("LOG_FILE", "logs/mark.log")

    # Paths
    PROMPTS_DIR: Path = PROJECT_ROOT / "prompts"
    DATA_DIR: Path = PROJECT_ROOT / "data"
    BRIEFINGS_DIR: Path = PROJECT_ROOT / "data" / "briefings"
    LOGS_DIR: Path = PROJECT_ROOT / "logs"

    # Known TLDR senders — used to filter emails
    TLDR_SENDERS = [
        "dan@tldrnewsletter.com",
        "founders@tldrnewsletter.com",
        "fintech@tldrnewsletter.com",
        "crypto@tldrnewsletter.com",
        "newsletter@tldr.tech",
        "dan@tldr.tech",
    ]

    # Known TLDR newsletter subject patterns
    TLDR_SUBJECT_PATTERNS = [
        "TLDR Founders",
        "TLDR Fintech",
        "TLDR Crypto",
    ]

    @classmethod
    def validate(cls) -> list[str]:
        """Check for missing required settings. Returns list of errors."""
        errors = []
        if not cls.IMAP_EMAIL:
            errors.append("IMAP_EMAIL is not set in .env")
        if not cls.IMAP_PASSWORD:
            errors.append("IMAP_PASSWORD is not set in .env")
        if not cls.ANTHROPIC_API_KEY:
            errors.append("ANTHROPIC_API_KEY is not set in .env")
        return errors

    @classmethod
    def ensure_dirs(cls):
        """Create required directories if they don't exist."""
        cls.DATA_DIR.mkdir(parents=True, exist_ok=True)
        cls.BRIEFINGS_DIR.mkdir(parents=True, exist_ok=True)
        cls.LOGS_DIR.mkdir(parents=True, exist_ok=True)
