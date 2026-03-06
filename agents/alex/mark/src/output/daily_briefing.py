"""
Daily executive briefing generator for Mark.
Produces a concise 1-2 minute strategic read covering:
  - What matters most today
  - Top 5 themes
  - What changed vs recent baseline
  - "Read this now" items
  - Strategic implications
  - Direct recommendations
  - What to watch next

Usage:
    python3 -m src.output.daily_briefing
"""

import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

from sqlalchemy import and_, func

from src.config import Config
from src.utils.logger import get_logger
from src.utils.models import (
    Newsletter, NewsletterItem, Category, DailySummary,
    TrendSnapshot, item_category, get_session,
)
from src.utils.llm import call_llm, load_prompt
from src.utils.helpers import now_utc, days_ago
from src.analysis.memory import get_top_themes, get_momentum_changes

logger = get_logger("mark.briefing")


def generate_daily_briefing(lookback_days: int = 1) -> str:
    """
    Generate today's executive briefing.
    Gathers recent items, themes, and trends, then uses the LLM to synthesize.
    """
    session = get_session()
    today = now_utc()
    cutoff = today - timedelta(days=lookback_days)

    # --- Gather context for the briefing ---

    # 1. Recent high-importance items
    top_items = (
        session.query(NewsletterItem, Newsletter)
        .join(Newsletter, Newsletter.id == NewsletterItem.newsletter_id)
        .filter(
            Newsletter.date >= cutoff,
            NewsletterItem.importance_score.isnot(None),
        )
        .order_by(NewsletterItem.importance_score.desc())
        .limit(20)
        .all()
    )

    # 2. Standout "Read This Now" items
    standouts = (
        session.query(NewsletterItem, Newsletter)
        .join(Newsletter, Newsletter.id == NewsletterItem.newsletter_id)
        .filter(
            Newsletter.date >= cutoff,
            NewsletterItem.is_standout == True,
        )
        .order_by(NewsletterItem.importance_score.desc())
        .limit(5)
        .all()
    )

    # 3. Top themes (7-day window)
    themes_7d = get_top_themes(window_days=7, limit=10)

    # 4. Momentum changes
    momentum = get_momentum_changes(window_days=7)

    # --- Build the LLM prompt context ---

    items_context = ""
    for item, nl in top_items:
        cats = [c.display_name for c in item.categories] if item.categories else []
        link_note = ""
        if item.link and item.link.page_summary:
            link_note = f"\n    Linked article: {item.link.page_summary[:200]}"
        items_context += (
            f"- [{nl.source.upper()}] {item.headline}\n"
            f"    Importance: {item.importance_score:.1f}/10 | "
            f"Attention: {item.attention_score:.1f}/10 | "
            f"Categories: {', '.join(cats)}\n"
            f"    Summary: {item.summary[:200] if item.summary else 'N/A'}"
            f"{link_note}\n\n"
        )

    standouts_context = ""
    for item, nl in standouts:
        standouts_context += (
            f"- [{nl.source.upper()}] {item.headline}\n"
            f"    URL: {item.url or 'N/A'}\n"
            f"    Why standout: {item.standout_reason or item.scoring_explanation or 'High importance'}\n\n"
        )

    themes_context = ""
    for t in themes_7d:
        themes_context += (
            f"- {t['category']}: {t['mentions']} mentions, "
            f"importance {t['avg_importance']:.1f}, {t['trend']}\n"
        )

    momentum_context = ""
    if momentum["accelerating"]:
        momentum_context += "Accelerating: " + ", ".join(
            f"{m['category']} ({m['momentum']:+.0%})" for m in momentum["accelerating"][:5]
        ) + "\n"
    if momentum["decelerating"]:
        momentum_context += "Decelerating: " + ", ".join(
            f"{m['category']} ({m['momentum']:+.0%})" for m in momentum["decelerating"][:5]
        ) + "\n"
    if momentum["new"]:
        momentum_context += "Newly emerging: " + ", ".join(
            m["category"] for m in momentum["new"][:3]
        ) + "\n"

    # --- Generate briefing with LLM ---

    prompt_template = load_prompt("daily_briefing.txt")
    prompt = prompt_template.format(
        date=today.strftime("%A, %B %d, %Y"),
        items_context=items_context or "No new items found.",
        standouts_context=standouts_context or "No standout items today.",
        themes_context=themes_context or "No theme data available yet.",
        momentum_context=momentum_context or "No momentum data available yet.",
    )

    briefing_text = call_llm(prompt, max_tokens=3000, temperature=0.3)

    # --- Save the briefing ---

    # Save to database
    daily_summary = DailySummary(
        summary_date=today.date(),
        content=briefing_text,
        top_themes_json=json.dumps(themes_7d),
        recommendations_json=None,  # Generated separately if needed
    )
    try:
        session.add(daily_summary)
        session.commit()
    except Exception:
        session.rollback()
        # Might already exist for today — update instead
        existing = session.query(DailySummary).filter(
            DailySummary.summary_date == today.date()
        ).first()
        if existing:
            existing.content = briefing_text
            existing.top_themes_json = json.dumps(themes_7d)
            session.commit()

    # Save to file
    Config.ensure_dirs()
    filepath = Config.BRIEFINGS_DIR / f"daily_{today:%Y-%m-%d}.md"
    filepath.write_text(briefing_text)
    logger.info(f"Daily briefing saved to {filepath}")

    session.close()
    return briefing_text


if __name__ == "__main__":
    briefing = generate_daily_briefing()
    print("\n" + "=" * 60)
    print("DAILY EXECUTIVE BRIEFING")
    print("=" * 60)
    print(briefing)
