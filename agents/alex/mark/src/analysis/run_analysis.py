"""
Analysis pipeline orchestrator for Mark.
Runs categorization → scoring → trend computation in sequence.

Usage:
    python3 -m src.analysis.run_analysis
"""

from src.utils.logger import get_logger
from src.analysis.categorizer import categorize_uncategorized_items
from src.analysis.scorer import score_unscored_items
from src.analysis.memory import compute_trend_snapshots

logger = get_logger("mark.analysis")


def run_full_analysis():
    """Run the complete analysis pipeline."""
    logger.info("Starting analysis pipeline...")

    # Step 1: Categorize items
    logger.info("Step 1/3: Categorizing items...")
    cat_count = categorize_uncategorized_items()
    logger.info(f"  → {cat_count} category assignments")

    # Step 2: Score items
    logger.info("Step 2/3: Scoring items...")
    score_count = score_unscored_items()
    logger.info(f"  → {score_count} items scored")

    # Step 3: Compute trend snapshots
    logger.info("Step 3/3: Computing trend snapshots...")
    compute_trend_snapshots()
    logger.info("  → Trends updated")

    logger.info("Analysis pipeline complete.")
    return {"categorized": cat_count, "scored": score_count}


if __name__ == "__main__":
    results = run_full_analysis()
    print(f"✓ Analysis complete: {results['categorized']} categorized, {results['scored']} scored.")
