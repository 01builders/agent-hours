"""
Memory and trend tracking for Mark.
Computes momentum, tracks recurring themes, detects acceleration/deceleration,
and maintains Mark's strategic memory across time windows.

Time windows:
  - 7 days (recent)
  - 30 days (month)
  - 90 days (quarter)
  - All-time (for reference)

Usage:
    Called from run_analysis.py
"""

from datetime import datetime, timezone, timedelta
from collections import defaultdict

from sqlalchemy import func, and_

from src.utils.logger import get_logger
from src.utils.models import (
    NewsletterItem, Newsletter, Category, TrendSnapshot,
    Entity, EntityMention, item_category, get_session,
)
from src.utils.helpers import now_utc, days_ago

logger = get_logger("mark.memory")


def compute_trend_snapshots():
    """
    Compute and store trend snapshots for all categories across time windows.
    This is the core memory system — it tracks what's rising, falling,
    and persisting over time.
    """
    session = get_session()
    today = now_utc().replace(hour=0, minute=0, second=0, microsecond=0)

    categories = session.query(Category).all()
    if not categories:
        logger.info("No categories found. Run categorization first.")
        return

    windows = [7, 30, 90]

    for cat in categories:
        for window_days in windows:
            cutoff = today - timedelta(days=window_days)
            prev_cutoff = cutoff - timedelta(days=window_days)

            # Count items in this category within the window
            current_count = (
                session.query(func.count(item_category.c.item_id))
                .join(NewsletterItem, NewsletterItem.id == item_category.c.item_id)
                .join(Newsletter, Newsletter.id == NewsletterItem.newsletter_id)
                .filter(
                    item_category.c.category_id == cat.id,
                    Newsletter.date >= cutoff,
                )
                .scalar() or 0
            )

            # Previous window count (for momentum calculation)
            prev_count = (
                session.query(func.count(item_category.c.item_id))
                .join(NewsletterItem, NewsletterItem.id == item_category.c.item_id)
                .join(Newsletter, Newsletter.id == NewsletterItem.newsletter_id)
                .filter(
                    item_category.c.category_id == cat.id,
                    Newsletter.date >= prev_cutoff,
                    Newsletter.date < cutoff,
                )
                .scalar() or 0
            )

            # Average importance in window
            avg_importance = (
                session.query(func.avg(NewsletterItem.importance_score))
                .join(item_category, item_category.c.item_id == NewsletterItem.id)
                .join(Newsletter, Newsletter.id == NewsletterItem.newsletter_id)
                .filter(
                    item_category.c.category_id == cat.id,
                    Newsletter.date >= cutoff,
                    NewsletterItem.importance_score.isnot(None),
                )
                .scalar() or 0.0
            )

            # Average attention in window
            avg_attention = (
                session.query(func.avg(NewsletterItem.attention_score))
                .join(item_category, item_category.c.item_id == NewsletterItem.id)
                .join(Newsletter, Newsletter.id == NewsletterItem.newsletter_id)
                .filter(
                    item_category.c.category_id == cat.id,
                    Newsletter.date >= cutoff,
                    NewsletterItem.attention_score.isnot(None),
                )
                .scalar() or 0.0
            )

            # Momentum: ratio of current to previous (>1 = growing, <1 = declining)
            if prev_count > 0:
                momentum = (current_count - prev_count) / prev_count
            elif current_count > 0:
                momentum = 1.0  # New category appearing
            else:
                momentum = 0.0

            # Upsert trend snapshot
            existing = (
                session.query(TrendSnapshot)
                .filter(
                    TrendSnapshot.category_id == cat.id,
                    TrendSnapshot.snapshot_date == today,
                    TrendSnapshot.window_days == window_days,
                )
                .first()
            )

            if existing:
                existing.mention_count = current_count
                existing.avg_importance = round(avg_importance, 2)
                existing.avg_attention = round(avg_attention, 2)
                existing.momentum_score = round(momentum, 3)
            else:
                session.add(TrendSnapshot(
                    category_id=cat.id,
                    snapshot_date=today,
                    window_days=window_days,
                    mention_count=current_count,
                    avg_importance=round(avg_importance, 2),
                    avg_attention=round(avg_attention, 2),
                    momentum_score=round(momentum, 3),
                ))

    session.commit()
    session.close()
    logger.info("Trend snapshots computed.")


def get_top_themes(window_days: int = 7, limit: int = 10) -> list[dict]:
    """
    Get the top themes by combined importance and mention count.
    Returns a list of dicts with category info and trend data.
    """
    session = get_session()
    today = now_utc().replace(hour=0, minute=0, second=0, microsecond=0)

    snapshots = (
        session.query(TrendSnapshot, Category)
        .join(Category, Category.id == TrendSnapshot.category_id)
        .filter(
            TrendSnapshot.snapshot_date == today,
            TrendSnapshot.window_days == window_days,
            TrendSnapshot.mention_count > 0,
        )
        .order_by(
            # Sort by a blend of importance and mention volume
            (TrendSnapshot.avg_importance * 0.6 + TrendSnapshot.mention_count * 0.4).desc()
        )
        .limit(limit)
        .all()
    )

    themes = []
    for snap, cat in snapshots:
        themes.append({
            "category": cat.display_name or cat.name,
            "category_key": cat.name,
            "mentions": snap.mention_count,
            "avg_importance": snap.avg_importance,
            "avg_attention": snap.avg_attention,
            "momentum": snap.momentum_score,
            "trend": _momentum_label(snap.momentum_score),
        })

    session.close()
    return themes


def get_momentum_changes(window_days: int = 7) -> dict:
    """
    Identify categories with significant momentum changes.
    Returns dict with 'accelerating', 'decelerating', and 'stable' lists.
    """
    session = get_session()
    today = now_utc().replace(hour=0, minute=0, second=0, microsecond=0)

    snapshots = (
        session.query(TrendSnapshot, Category)
        .join(Category, Category.id == TrendSnapshot.category_id)
        .filter(
            TrendSnapshot.snapshot_date == today,
            TrendSnapshot.window_days == window_days,
            TrendSnapshot.mention_count > 0,
        )
        .all()
    )

    result = {"accelerating": [], "decelerating": [], "stable": [], "new": []}

    for snap, cat in snapshots:
        entry = {
            "category": cat.display_name or cat.name,
            "momentum": snap.momentum_score,
            "mentions": snap.mention_count,
            "avg_importance": snap.avg_importance,
        }
        if snap.momentum_score > 0.3:
            result["accelerating"].append(entry)
        elif snap.momentum_score < -0.2:
            result["decelerating"].append(entry)
        elif snap.momentum_score == 1.0 and snap.mention_count > 0:
            result["new"].append(entry)
        else:
            result["stable"].append(entry)

    # Sort each group by importance
    for key in result:
        result[key].sort(key=lambda x: x["avg_importance"], reverse=True)

    session.close()
    return result


def get_recurring_problems(days: int = 30) -> list[dict]:
    """
    Find items/topics that appear repeatedly, suggesting persistent problems.
    """
    session = get_session()
    cutoff = days_ago(days)

    # Find categories that appear consistently across multiple newsletter dates
    category_dates = (
        session.query(
            Category.name,
            Category.display_name,
            func.count(func.distinct(Newsletter.date)).label("date_count"),
            func.count(NewsletterItem.id).label("item_count"),
            func.avg(NewsletterItem.importance_score).label("avg_importance"),
        )
        .join(item_category, item_category.c.category_id == Category.id)
        .join(NewsletterItem, NewsletterItem.id == item_category.c.item_id)
        .join(Newsletter, Newsletter.id == NewsletterItem.newsletter_id)
        .filter(Newsletter.date >= cutoff)
        .group_by(Category.id)
        .having(func.count(func.distinct(Newsletter.date)) >= 3)
        .order_by(func.avg(NewsletterItem.importance_score).desc())
        .all()
    )

    problems = []
    for name, display_name, date_count, item_count, avg_imp in category_dates:
        problems.append({
            "category": display_name or name,
            "appearances": date_count,
            "total_items": item_count,
            "avg_importance": round(avg_imp or 0, 2),
        })

    session.close()
    return problems


def _momentum_label(score: float) -> str:
    """Convert momentum score to human-readable label."""
    if score > 0.5:
        return "↑↑ surging"
    elif score > 0.2:
        return "↑ rising"
    elif score > -0.1:
        return "→ steady"
    elif score > -0.3:
        return "↓ fading"
    else:
        return "↓↓ declining"


if __name__ == "__main__":
    compute_trend_snapshots()
    themes = get_top_themes(7)
    print("\nTop themes (7d):")
    for t in themes:
        print(f"  {t['category']}: {t['mentions']} mentions, "
              f"importance {t['avg_importance']:.1f}, {t['trend']}")
