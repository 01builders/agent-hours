"""
Logging configuration for Mark.
All modules import get_logger() from here.
"""

import logging
import sys
from pathlib import Path
from src.config import Config


def get_logger(name: str = "mark") -> logging.Logger:
    """Get a configured logger instance."""
    logger = logging.getLogger(name)

    # Only add handlers if none exist (prevents duplicates)
    if not logger.handlers:
        logger.setLevel(getattr(logging, Config.LOG_LEVEL, logging.INFO))

        # Format: timestamp — module — level — message
        formatter = logging.Formatter(
            "%(asctime)s — %(name)s — %(levelname)s — %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

        # Console handler
        console = logging.StreamHandler(sys.stdout)
        console.setFormatter(formatter)
        logger.addHandler(console)

        # File handler
        Config.ensure_dirs()
        log_path = Path(Config.LOG_FILE)
        if not log_path.is_absolute():
            log_path = Config.LOGS_DIR / log_path.name
        file_handler = logging.FileHandler(log_path)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)

    return logger
