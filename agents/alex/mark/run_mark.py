#!/usr/bin/env python3
"""
Mark — One-command daily runner.

Runs the full pipeline:
  1. Ingest new newsletter emails from IMAP
  2. Enrich links found in newsletters
  3. Categorize, score, and compute trends
  4. Generate daily executive briefing

Usage:
    python3 run_mark.py
"""

import sys
import traceback
from datetime import datetime

from src.config import Config
from src.utils.logger import get_logger
from src.utils.db_init import init_db

logger = get_logger("mark.runner")


def main():
    """Run the full Mark pipeline."""
    start_time = datetime.now()
    logger.info("=" * 50)
    logger.info("Mark — Starting daily run")
    logger.info("=" * 50)

    # Validate config
    errors = Config.validate()
    if errors:
        for err in errors:
            logger.error(f"Config error: {err}")
        print("\n❌ Configuration errors found. Please check your .env file:")
        for err in errors:
            print(f"   • {err}")
        sys.exit(1)

    # Ensure database exists
    init_db()

    # Step 1: Ingest emails
    logger.info("Step 1/4: Ingesting newsletter emails...")
    try:
        from src.ingestion.ingest import ingest_emails
        ingest_count = ingest_emails()
        logger.info(f"  → {ingest_count} new newsletter(s) ingested")
    except Exception as e:
        logger.error(f"Ingestion failed: {e}")
        traceback.print_exc()
        # Continue with analysis even if ingestion fails (might have old data)

    # Step 2: Enrich links
    logger.info("Step 2/4: Enriching links...")
    try:
        from src.ingestion.enrich_links import enrich_pending_links
        link_count = enrich_pending_links()
        logger.info(f"  → {link_count} link(s) enriched")
    except Exception as e:
        logger.error(f"Link enrichment failed: {e}")
        traceback.print_exc()

    # Step 3: Run analysis
    logger.info("Step 3/4: Running analysis pipeline...")
    try:
        from src.analysis.run_analysis import run_full_analysis
        analysis = run_full_analysis()
        logger.info(f"  → {analysis['categorized']} categorized, {analysis['scored']} scored")
    except Exception as e:
        logger.error(f"Analysis failed: {e}")
        traceback.print_exc()

    # Step 4: Generate daily briefing
    logger.info("Step 4/4: Generating daily briefing...")
    try:
        from src.output.daily_briefing import generate_daily_briefing
        briefing = generate_daily_briefing()
        if briefing:
            logger.info("  → Daily briefing generated")
            print("\n" + "=" * 60)
            print("TODAY'S BRIEFING")
            print("=" * 60)
            print(briefing)
    except Exception as e:
        logger.error(f"Briefing generation failed: {e}")
        traceback.print_exc()

    elapsed = (datetime.now() - start_time).total_seconds()
    logger.info(f"Mark daily run complete in {elapsed:.0f}s")
    print(f"\n✓ Done in {elapsed:.0f}s. Launch dashboard: streamlit run src/dashboard.py")


if __name__ == "__main__":
    main()
