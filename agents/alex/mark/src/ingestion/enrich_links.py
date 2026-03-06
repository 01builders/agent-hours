"""
Link enrichment for Mark.
Fetches pages linked in newsletters, extracts text, and uses the LLM
to generate summaries and extract entities.

IMPORTANT: Only processes links found inside TLDR newsletters.
No external browsing or discovery.

Usage:
    python3 -m src.ingestion.enrich_links
"""

import time
import json
import requests
from datetime import datetime, timezone

from bs4 import BeautifulSoup
from readability import Document as ReadabilityDocument

from src.config import Config
from src.utils.logger import get_logger
from src.utils.models import EnrichedLink, get_session
from src.utils.llm import call_llm_json, load_prompt
from src.utils.helpers import safe_truncate, url_domain, now_utc

logger = get_logger("mark.enrich")

# Domains to skip (paywalled, social, or not useful to fetch)
SKIP_DOMAINS = {
    "twitter.com", "x.com", "linkedin.com", "facebook.com",
    "instagram.com", "youtube.com", "youtu.be", "reddit.com",
    "tiktok.com", "t.co", "bit.ly",
}

# Request headers to look like a normal browser
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch_page_content(url: str) -> tuple[str, str, str]:
    """
    Fetch a URL and extract readable content.
    Returns (title, clean_text, final_url).
    """
    try:
        response = requests.get(
            url,
            headers=HEADERS,
            timeout=15,
            allow_redirects=True,
        )
        response.raise_for_status()

        # Use readability to extract main content
        doc = ReadabilityDocument(response.text)
        title = doc.title() or ""

        # Get clean text from readable content
        readable_html = doc.summary()
        soup = BeautifulSoup(readable_html, "lxml")
        clean_text = soup.get_text(separator="\n", strip=True)

        # Fallback: if readability gives too little, use full page
        if len(clean_text) < 100:
            soup_full = BeautifulSoup(response.text, "lxml")
            # Remove script/style
            for tag in soup_full(["script", "style", "nav", "footer", "header"]):
                tag.decompose()
            clean_text = soup_full.get_text(separator="\n", strip=True)

        return title, clean_text, response.url

    except requests.exceptions.Timeout:
        logger.warning(f"Timeout fetching {url}")
        return "", "", url
    except requests.exceptions.RequestException as e:
        logger.warning(f"Failed to fetch {url}: {e}")
        return "", "", url


def summarize_page(title: str, text: str, source_headline: str) -> dict:
    """
    Use the LLM to summarize a fetched page and extract entities.
    Returns dict with: summary, key_entities, inferred_category.
    """
    if not text or len(text.strip()) < 50:
        return {"summary": "", "key_entities": [], "inferred_category": ""}

    truncated_text = safe_truncate(text, 4000)

    prompt_template = load_prompt("summarize_link.txt")
    prompt = prompt_template.format(
        title=title,
        source_headline=source_headline,
        page_text=truncated_text,
    )

    result = call_llm_json(prompt)

    return {
        "summary": result.get("summary", ""),
        "key_entities": result.get("key_entities", []),
        "inferred_category": result.get("inferred_category", ""),
    }


def enrich_pending_links():
    """
    Process all pending links: fetch, summarize, store.
    Respects MAX_LINKS_PER_RUN to control API costs.
    """
    session = get_session()

    # Get pending links
    pending = (
        session.query(EnrichedLink)
        .filter(EnrichedLink.fetch_status == "pending")
        .limit(Config.MAX_LINKS_PER_RUN)
        .all()
    )

    if not pending:
        logger.info("No pending links to enrich.")
        return 0

    logger.info(f"Enriching {len(pending)} links...")
    enriched_count = 0

    for link in pending:
        try:
            domain = url_domain(link.url)

            # Skip social media and known-bad domains
            if any(skip in domain for skip in SKIP_DOMAINS):
                link.fetch_status = "skipped"
                link.fetched_at = now_utc()
                session.commit()
                continue

            logger.info(f"Fetching: {link.url[:80]}...")

            # Fetch the page
            title, text, final_url = fetch_page_content(link.url)

            if not text or len(text.strip()) < 50:
                link.fetch_status = "failed"
                link.title = title or None
                link.final_url = final_url
                link.fetched_at = now_utc()
                session.commit()
                continue

            # Get the source headline for context
            source_headline = ""
            if link.item:
                source_headline = link.item.headline or ""

            # Summarize with LLM
            summary_data = summarize_page(title, text, source_headline)

            # Update the link record
            link.title = title[:500] if title else None
            link.final_url = final_url
            link.page_summary = summary_data.get("summary", "")
            link.key_entities = json.dumps(summary_data.get("key_entities", []))
            link.inferred_category = summary_data.get("inferred_category", "")
            link.fetch_status = "success"
            link.fetched_at = now_utc()

            session.commit()
            enriched_count += 1

            # Be polite — don't hammer servers
            time.sleep(1)

        except Exception as e:
            logger.error(f"Error enriching link {link.url[:60]}: {e}")
            link.fetch_status = "failed"
            link.fetched_at = now_utc()
            session.commit()
            continue

    session.close()
    logger.info(f"Link enrichment complete. {enriched_count} links enriched.")
    return enriched_count


if __name__ == "__main__":
    count = enrich_pending_links()
    print(f"✓ Enriched {count} link(s).")
