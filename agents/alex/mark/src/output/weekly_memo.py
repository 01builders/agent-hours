"""
Weekly strategic memo generator for Mark.
Produces a deeper synthesis covering:
  - Biggest shifts
  - Strongest emerging themes
  - Weakening themes
  - Unresolved pain points
  - Roadmap implications
  - Messaging / positioning implications
  - Acquisition / partnership signals
  - What to discuss internally

Usage:
    python3 -m src.output.weekly_memo
"""

import json
from datetime import timedelta

from sqlalchemy import func

from src.config import Config
from src.utils.logger import get_logger
from src.utils.models import (
    Newsletter, NewsletterItem, Category, WeeklySummary,
    TrendSnapshot, item_category, get_session,
)
from src.utils.llm import call_llm, load_prompt
from src.utils.helpers import now_utc, days_ago
from src.analysis.memory import get_top_themes, get_momentum_changes, get_recurring_problems

logger = get_logger("mark.weekly")


def generate_weekly_memo() -> str:
    """
    Generate this week's strategic memo.
    Looks back 7 days and compares to 30-day and 90-day baselines.
    """
    session = get_session()
    today = now_utc()
    week_start = today - timedelta(days=7)

    # --- Gather comprehensive context ---

    # 1. All items from the past week, sorted by importance
    week_items = (
        session.query(NewsletterItem, Newsletter)
        .join(Newsletter, Newsletter.id == NewsletterItem.newsletter_id)
        .filter(
            Newsletter.date >= week_start,
            NewsletterItem.importance_score.isnot(None),
        )
        .order_by(NewsletterItem.importance_score.desc())
        .limit(40)
        .all()
    )

    # 2. Standout items this week
    standouts = (
        session.query(NewsletterItem, Newsletter)
        .join(Newsletter, Newsletter.id == NewsletterItem.newsletter_id)
        .filter(
            Newsletter.date >= week_start,
            NewsletterItem.is_standout == True,
        )
        .all()
    )

    # 3. Theme data at multiple time horizons
    themes_7d = get_top_themes(window_days=7, limit=15)
    themes_30d = get_top_themes(window_days=30, limit=15)

    # 4. Momentum analysis
    momentum_7d = get_momentum_changes(window_days=7)
    momentum_30d = get_momentum_changes(window_days=30)

    # 5. Recurring problems
    recurring = get_recurring_problems(days=30)

    # --- Build context strings ---

    items_context = ""
    for item, nl in week_items[:30]:
        cats = [c.display_name for c in item.categories] if item.categories else []
        link_info = ""
        if item.link and item.link.page_summary:
            link_info = f"\n    Article: {item.link.page_summary[:250]}"
        items_context += (
            f"- [{nl.source.upper()} {nl.date:%m/%d}] {item.headline}\n"
            f"    Importance: {item.importance_score:.1f} | Categories: {', '.join(cats)}\n"
            f"    {item.summary[:250] if item.summary else ''}"
            f"{link_info}\n\n"
        )

    standouts_text = ""
    for item, nl in standouts:
        standouts_text += (
            f"- {item.headline} ({nl.source}, {nl.date:%m/%d})\n"
            f"  {item.standout_reason or 'High strategic value'}\n"
            f"  URL: {item.url or 'N/A'}\n\n"
        )

    themes_comparison = "7-DAY THEMES:\n"
    for t in themes_7d:
        themes_comparison += (
            f"  {t['category']}: {t['mentions']} mentions, "
            f"importance {t['avg_importance']:.1f}, {t['trend']}\n"
        )
    themes_comparison += "\n30-DAY THEMES:\n"
    for t in themes_30d:
        themes_comparison += (
            f"  {t['category']}: {t['mentions']} mentions, "
            f"importance {t['avg_importance']:.1f}, {t['trend']}\n"
        )

    momentum_text = "ACCELERATING (7d):\n"
    for m in momentum_7d.get("accelerating", [])[:5]:
        momentum_text += f"  ↑ {m['category']} ({m['momentum']:+.0%})\n"
    momentum_text += "\nDECELERATING (7d):\n"
    for m in momentum_7d.get("decelerating", [])[:5]:
        momentum_text += f"  ↓ {m['category']} ({m['momentum']:+.0%})\n"

    recurring_text = ""
    for r in recurring[:10]:
        recurring_text += (
            f"  {r['category']}: appeared on {r['appearances']} dates, "
            f"{r['total_items']} items, avg importance {r['avg_importance']:.1f}\n"
        )

    # --- Generate memo with LLM ---

    prompt_template = load_prompt("weekly_memo.txt")
    prompt = prompt_template.format(
        week_start=week_start.strftime("%B %d"),
        week_end=today.strftime("%B %d, %Y"),
        items_context=items_context or "No items this week.",
        standouts_text=standouts_text or "No standout items.",
        themes_comparison=themes_comparison,
        momentum_text=momentum_text,
        recurring_text=recurring_text or "Insufficient data for recurring analysis.",
    )

    memo_text = call_llm(prompt, max_tokens=4096, temperature=0.3)

    # --- Save ---

    try:
        weekly = WeeklySummary(
            week_start=week_start,
            week_end=today,
            content=memo_text,
        )
        session.add(weekly)
        session.commit()
    except Exception:
        session.rollback()

    Config.ensure_dirs()
    filepath = Config.BRIEFINGS_DIR / f"weekly_{today:%Y-%m-%d}.md"
    filepath.write_text(memo_text)
    logger.info(f"Weekly memo saved to {filepath}")

    session.close()
    return memo_text


if __name__ == "__main__":
    memo = generate_weekly_memo()
    print("\n" + "=" * 60)
    print("WEEKLY STRATEGIC MEMO")
    print("=" * 60)
    print(memo)
