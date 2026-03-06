"""
Newsletter parser for Mark.
Parses TLDR Founders / Fintech / Crypto email HTML into structured items.

TLDR newsletters follow a consistent format:
  - Sections with headers (e.g., "📊 BIG TECH & STARTUPS", "🚀 HEADLINES")
  - Items with a linked headline, followed by a summary paragraph
  - Quick links section at the bottom
"""

import re
from dataclasses import dataclass, field
from bs4 import BeautifulSoup
from urllib.parse import urlparse

from src.utils.logger import get_logger

logger = get_logger("mark.parser")


@dataclass
class ParsedItem:
    """A single item extracted from a newsletter."""
    section: str = ""
    headline: str = ""
    summary: str = ""
    url: str = ""
    position: int = 0


@dataclass
class ParsedNewsletter:
    """Fully parsed newsletter structure."""
    items: list[ParsedItem] = field(default_factory=list)
    all_links: list[str] = field(default_factory=list)


def parse_newsletter_html(html: str) -> ParsedNewsletter:
    """
    Parse a TLDR newsletter HTML email into structured items.

    Strategy:
    1. Find all links that look like article links (not unsubscribe, social, etc.)
    2. Group them by section headers
    3. Extract the surrounding text as summary
    """
    result = ParsedNewsletter()

    if not html:
        return result

    soup = BeautifulSoup(html, "lxml")

    # Collect all meaningful links first
    result.all_links = _extract_all_article_links(soup)

    # Try structured parsing first
    items = _parse_structured(soup)
    if items:
        result.items = items
        return result

    # Fallback: simpler text-based parsing
    items = _parse_text_based(html)
    if items:
        result.items = items
        return result

    logger.warning("Could not parse newsletter into items. Storing raw only.")
    return result


def _extract_all_article_links(soup: BeautifulSoup) -> list[str]:
    """Extract all article-like links from the newsletter."""
    links = []
    skip_domains = {
        "tldr.tech", "tldrnewsletter.com", "list-manage.com", "mailchimp.com",
        "twitter.com", "x.com", "linkedin.com", "facebook.com",
        "instagram.com", "youtube.com",
    }
    skip_patterns = [
        "unsubscribe", "manage-preferences", "mailto:", "advertise",
        "referral", "share?", "forward-to-friend",
    ]

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href.startswith("http"):
            continue

        domain = urlparse(href).netloc.lower()
        # Skip internal / social / tracking links
        if any(sd in domain for sd in skip_domains):
            continue
        if any(pat in href.lower() for pat in skip_patterns):
            continue

        # Skip very short links (likely icons/images)
        link_text = a.get_text(strip=True)
        if len(link_text) < 3 and not href.endswith(('.pdf', '.html')):
            continue

        if href not in links:
            links.append(href)

    return links


def _parse_structured(soup: BeautifulSoup) -> list[ParsedItem]:
    """
    Parse TLDR newsletter HTML by looking for patterns:
    - Bold or large text as headlines
    - Links within those headlines
    - Following paragraphs as summaries
    """
    items = []
    position = 0

    # TLDR newsletters often use table-based layouts
    # Look for text blocks that contain a link followed by descriptive text
    current_section = "General"

    # Find all text content blocks
    for td in soup.find_all(["td", "div"]):
        text = td.get_text(separator="\n", strip=True)
        if not text or len(text) < 20:
            continue

        # Detect section headers (often emoji + ALL CAPS)
        section_match = re.search(
            r'[📊🚀💡🔥📈💰🧠⚡🔒🛠️📱💼🏗️🌐📰🔑]*\s*([A-Z][A-Z &/\-]{4,})',
            text
        )
        if section_match:
            potential_section = section_match.group(1).strip()
            if len(potential_section) < 60:
                current_section = potential_section

        # Find links that look like article headlines
        for a in td.find_all("a", href=True):
            link_text = a.get_text(strip=True)
            href = a["href"].strip()

            # Must be a real headline (not "Read more", not tiny)
            if len(link_text) < 10:
                continue
            if link_text.lower() in ("read more", "continue reading", "click here"):
                continue
            if not href.startswith("http"):
                continue

            # Skip TLDR internal links
            domain = urlparse(href).netloc.lower()
            if "tldr" in domain or "mailchimp" in domain or "list-manage" in domain:
                continue

            # Get surrounding text as summary
            summary = _extract_summary_near(a, td)

            position += 1
            items.append(ParsedItem(
                section=current_section,
                headline=link_text,
                summary=summary,
                url=href,
                position=position,
            ))

    return items


def _extract_summary_near(link_elem, container) -> str:
    """Extract summary text near a link element."""
    # Get the parent's text and remove the headline
    headline_text = link_elem.get_text(strip=True)
    container_text = container.get_text(separator=" ", strip=True)

    # Find text after the headline
    idx = container_text.find(headline_text)
    if idx >= 0:
        after = container_text[idx + len(headline_text):].strip()
        # Clean up — take first ~500 chars, ending at sentence boundary
        after = re.sub(r'\s+', ' ', after)[:500]
        # Try to end at a sentence
        sent_end = max(after.rfind('. '), after.rfind('.\n'))
        if sent_end > 50:
            after = after[:sent_end + 1]
        return after.strip()
    return ""


def _parse_text_based(html: str) -> list[ParsedItem]:
    """
    Fallback parser: convert to text and look for URL + description patterns.
    """
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(separator="\n")
    items = []
    position = 0

    # Find lines that look like headlines (capitalized, medium length)
    lines = text.split("\n")
    for i, line in enumerate(lines):
        line = line.strip()
        if not line or len(line) < 15:
            continue

        # Look for lines followed by a URL on the next line or containing a link pattern
        # Or lines that are title-case and have substantial length
        if 15 < len(line) < 200 and not line.startswith("http"):
            # Check if there's a URL nearby in the original HTML
            urls = _find_urls_for_headline(line, html)
            if urls:
                # Gather summary from following lines
                summary_lines = []
                for j in range(i + 1, min(i + 5, len(lines))):
                    next_line = lines[j].strip()
                    if not next_line or next_line.startswith("http"):
                        break
                    if len(next_line) > 10:
                        summary_lines.append(next_line)

                position += 1
                items.append(ParsedItem(
                    section="General",
                    headline=line,
                    summary=" ".join(summary_lines)[:500],
                    url=urls[0],
                    position=position,
                ))

    return items


def _find_urls_for_headline(headline: str, html: str) -> list[str]:
    """Find URLs associated with a headline in HTML source."""
    soup = BeautifulSoup(html, "lxml")
    for a in soup.find_all("a", href=True):
        if headline[:30] in a.get_text(strip=True):
            href = a["href"].strip()
            if href.startswith("http") and "tldr" not in href.lower():
                return [href]
    return []


def parse_newsletter_text(text: str) -> ParsedNewsletter:
    """
    Parse plain-text version of a newsletter.
    Used as fallback when HTML is not available.
    """
    result = ParsedNewsletter()
    if not text:
        return result

    items = []
    position = 0
    current_section = "General"
    lines = text.split("\n")

    i = 0
    while i < len(lines):
        line = lines[i].strip()

        # Detect section headers
        if re.match(r'^[A-Z][A-Z &/\-]{4,}$', line):
            current_section = line
            i += 1
            continue

        # Look for URLs
        url_match = re.search(r'(https?://[^\s]+)', line)
        if url_match:
            url = url_match.group(1).rstrip(")")
            # Headline is likely the previous non-empty line
            headline = ""
            for j in range(i - 1, max(i - 4, -1), -1):
                prev = lines[j].strip()
                if prev and len(prev) > 10 and not prev.startswith("http"):
                    headline = prev
                    break

            if headline:
                # Gather summary
                summary_parts = []
                for j in range(i + 1, min(i + 4, len(lines))):
                    nxt = lines[j].strip()
                    if not nxt:
                        break
                    summary_parts.append(nxt)

                position += 1
                items.append(ParsedItem(
                    section=current_section,
                    headline=headline,
                    summary=" ".join(summary_parts)[:500],
                    url=url,
                    position=position,
                ))

        i += 1

    result.items = items
    # Extract all URLs from text
    result.all_links = re.findall(r'https?://[^\s\)]+', text)
    return result
