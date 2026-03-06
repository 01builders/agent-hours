"""
Strategic importance scoring for Mark.
Ranks newsletter items by strategic value, NOT by hype.

Scoring framework:
  - Separates "attention volume" (how much buzz) from "strategic importance"
  - Uses transparent, explainable signals
  - Deprioritizes price chatter, fluff, noise
  - Prioritizes problems, gaps, infrastructure, builders, M&A signals

Usage:
    Called from run_analysis.py
"""

from sqlalchemy import and_

from src.utils.logger import get_logger
from src.utils.models import NewsletterItem, EnrichedLink, Category, item_category, get_session
from src.utils.llm import call_llm_json, load_prompt

logger = get_logger("mark.scorer")


def score_unscored_items(batch_size: int = 15):
    """
    Find items without importance scores and score them using the LLM.
    """
    session = get_session()

    # Get unscored items
    unscored = (
        session.query(NewsletterItem)
        .filter(NewsletterItem.importance_score.is_(None))
        .limit(batch_size * 5)
        .all()
    )

    if not unscored:
        logger.info("All items are scored.")
        return 0

    logger.info(f"Scoring {len(unscored)} items...")
    scored_count = 0

    for i in range(0, len(unscored), batch_size):
        batch = unscored[i:i + batch_size]

        # Build batch context with enrichment data
        items_text = []
        for item in batch:
            # Get categories
            cats = [c.name for c in item.categories] if item.categories else []

            # Get link summary
            link_info = ""
            if item.link and item.link.page_summary:
                link_info = f" | Linked article: {item.link.page_summary[:300]}"

            items_text.append(
                f"ID:{item.id} | Section: {item.section or 'N/A'} | "
                f"Headline: {item.headline} | "
                f"Summary: {item.summary[:300] if item.summary else 'N/A'} | "
                f"Categories: {', '.join(cats) if cats else 'untagged'}"
                f"{link_info}"
            )

        prompt_template = load_prompt("score.txt")
        prompt = prompt_template.format(items_text="\n---\n".join(items_text))

        result = call_llm_json(prompt)

        if not isinstance(result, list):
            logger.warning(f"Unexpected scoring result type: {type(result)}")
            continue

        for entry in result:
            item_id = entry.get("id")
            if not item_id:
                continue

            item = session.query(NewsletterItem).get(item_id)
            if not item:
                continue

            item.importance_score = float(entry.get("importance_score", 0))
            item.attention_score = float(entry.get("attention_score", 0))
            item.scoring_explanation = entry.get("explanation", "")

            # Detect standout items
            is_standout = entry.get("is_standout", False)
            if is_standout or item.importance_score >= 8.0:
                item.is_standout = True
                item.standout_reason = entry.get("standout_reason", "High strategic importance")

            scored_count += 1

        session.commit()

    session.close()
    logger.info(f"Scoring complete. {scored_count} items scored.")
    return scored_count


if __name__ == "__main__":
    count = score_unscored_items()
    print(f"✓ Scored {count} items.")
