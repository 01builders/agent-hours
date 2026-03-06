"""
Database models for Mark.
Defines the complete schema for newsletters, items, links, categories,
scores, trends, and generated outputs.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Text, Float, Boolean, DateTime,
    ForeignKey, Table, UniqueConstraint, Index, create_engine,
)
from sqlalchemy.orm import declarative_base, relationship, Session, sessionmaker

from src.config import Config

Base = declarative_base()


# ── Many-to-many: items ↔ categories ─────────────────────────────────────────

item_category = Table(
    "item_category",
    Base.metadata,
    Column("item_id", Integer, ForeignKey("newsletter_items.id"), primary_key=True),
    Column("category_id", Integer, ForeignKey("categories.id"), primary_key=True),
)


# ── Newsletter (one row per email edition) ────────────────────────────────────

class Newsletter(Base):
    __tablename__ = "newsletters"

    id = Column(Integer, primary_key=True, autoincrement=True)
    message_id = Column(String(512), unique=True, nullable=False)  # IMAP Message-ID for dedup
    source = Column(String(64), nullable=False)       # "founders" | "fintech" | "crypto"
    subject = Column(String(512), nullable=False)
    date = Column(DateTime, nullable=False)
    raw_text = Column(Text, nullable=True)             # Full plain-text body
    raw_html = Column(Text, nullable=True)             # Full HTML body
    ingested_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    items = relationship("NewsletterItem", back_populates="newsletter", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Newsletter {self.source} {self.date:%Y-%m-%d}>"


# ── Newsletter Item (a single headline/blurb within a newsletter) ─────────────

class NewsletterItem(Base):
    __tablename__ = "newsletter_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    newsletter_id = Column(Integer, ForeignKey("newsletters.id"), nullable=False)
    section = Column(String(128), nullable=True)       # e.g. "Headlines", "Big Tech", "Quick Links"
    headline = Column(String(512), nullable=False)
    summary = Column(Text, nullable=True)              # Bullet text from newsletter
    url = Column(String(2048), nullable=True)          # Primary link if present
    position = Column(Integer, nullable=True)          # Order within newsletter

    # Analysis fields (populated by analysis pipeline)
    importance_score = Column(Float, nullable=True)    # 0-10 strategic importance
    attention_score = Column(Float, nullable=True)     # 0-10 how much buzz
    is_standout = Column(Boolean, default=False)       # "Read This Now" flag
    standout_reason = Column(Text, nullable=True)      # Why it's a standout
    scoring_explanation = Column(Text, nullable=True)   # Why it scored this way

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    newsletter = relationship("Newsletter", back_populates="items")
    categories = relationship("Category", secondary=item_category, back_populates="items")
    link = relationship("EnrichedLink", back_populates="item", uselist=False)

    def __repr__(self):
        return f"<Item '{self.headline[:50]}...'>"


# ── Enriched Link (fetched + summarized linked page) ─────────────────────────

class EnrichedLink(Base):
    __tablename__ = "enriched_links"

    id = Column(Integer, primary_key=True, autoincrement=True)
    item_id = Column(Integer, ForeignKey("newsletter_items.id"), nullable=False)
    url = Column(String(2048), nullable=False)
    final_url = Column(String(2048), nullable=True)    # After redirects
    title = Column(String(512), nullable=True)
    page_summary = Column(Text, nullable=True)
    key_entities = Column(Text, nullable=True)          # JSON list of entities
    inferred_category = Column(String(128), nullable=True)
    fetch_status = Column(String(32), default="pending")  # pending | success | failed | skipped
    fetched_at = Column(DateTime, nullable=True)

    item = relationship("NewsletterItem", back_populates="link")

    __table_args__ = (
        UniqueConstraint("item_id", "url", name="uq_item_url"),
    )


# ── Category / Theme ─────────────────────────────────────────────────────────

class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(128), unique=True, nullable=False)   # e.g. "stablecoins"
    display_name = Column(String(128), nullable=True)          # e.g. "Stablecoins"
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    items = relationship("NewsletterItem", secondary=item_category, back_populates="categories")

    def __repr__(self):
        return f"<Category '{self.name}'>"


# ── Trend Snapshot (periodic measurement of a category's momentum) ────────────

class TrendSnapshot(Base):
    __tablename__ = "trend_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=False)
    snapshot_date = Column(DateTime, nullable=False)
    window_days = Column(Integer, nullable=False)       # 7, 30, or 90
    mention_count = Column(Integer, default=0)
    avg_importance = Column(Float, default=0.0)
    avg_attention = Column(Float, default=0.0)
    momentum_score = Column(Float, default=0.0)         # Change vs previous window
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint("category_id", "snapshot_date", "window_days", name="uq_trend"),
        Index("ix_trend_date", "snapshot_date"),
    )


# ── Entity (companies, people, protocols mentioned repeatedly) ────────────────

class Entity(Base):
    __tablename__ = "entities"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(256), unique=True, nullable=False)
    entity_type = Column(String(64), nullable=True)    # company | person | protocol | product
    first_seen = Column(DateTime, nullable=True)
    mention_count = Column(Integer, default=0)

    def __repr__(self):
        return f"<Entity '{self.name}'>"


# ── Entity Mention (links an entity to a newsletter item) ─────────────────────

class EntityMention(Base):
    __tablename__ = "entity_mentions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    entity_id = Column(Integer, ForeignKey("entities.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("newsletter_items.id"), nullable=False)


# ── Daily Summary (stored output of daily briefing) ──────────────────────────

class DailySummary(Base):
    __tablename__ = "daily_summaries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    summary_date = Column(DateTime, unique=True, nullable=False)
    content = Column(Text, nullable=False)              # Full briefing text
    top_themes_json = Column(Text, nullable=True)       # JSON of top themes
    recommendations_json = Column(Text, nullable=True)  # JSON of recommendations
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


# ── Weekly Summary ────────────────────────────────────────────────────────────

class WeeklySummary(Base):
    __tablename__ = "weekly_summaries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    week_start = Column(DateTime, nullable=False)
    week_end = Column(DateTime, nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint("week_start", "week_end", name="uq_weekly"),
    )


# ── Database engine / session factory ─────────────────────────────────────────

def get_engine():
    """Create SQLAlchemy engine."""
    Config.ensure_dirs()
    return create_engine(Config.DATABASE_URL, echo=False)


def get_session() -> Session:
    """Create a new database session."""
    engine = get_engine()
    SessionFactory = sessionmaker(bind=engine)
    return SessionFactory()
