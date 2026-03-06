"""
Database initialization for Mark.
Creates all tables. Safe to run multiple times.

Usage:
    python3 -m src.utils.db_init
"""

from src.utils.models import Base, get_engine
from src.utils.logger import get_logger
from src.config import Config

logger = get_logger("mark.db_init")


def init_db():
    """Create all database tables."""
    Config.ensure_dirs()
    engine = get_engine()
    Base.metadata.create_all(engine)
    logger.info(f"Database initialized at {Config.DATABASE_PATH}")


if __name__ == "__main__":
    init_db()
    print(f"✓ Database ready at {Config.DATABASE_PATH}")
