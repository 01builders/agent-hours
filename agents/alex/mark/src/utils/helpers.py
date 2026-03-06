"""
Shared helper functions for Mark.
"""

import re
import hashlib
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse


def clean_url(url: str) -> str:
    """Strip tracking parameters and normalize a URL."""
    if not url:
        return ""
    # Remove common tracking params
    parsed = urlparse(url)
    clean = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
    # Remove trailing slashes for consistency
    return clean.rstrip("/")


def url_domain(url: str) -> str:
    """Extract the domain from a URL."""
    try:
        return urlparse(url).netloc
    except Exception:
        return ""


def hash_text(text: str) -> str:
    """Create a short hash of text for dedup."""
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def days_ago(n: int) -> datetime:
    """Return a datetime N days in the past (UTC)."""
    return datetime.now(timezone.utc) - timedelta(days=n)


def safe_truncate(text: str, max_chars: int = 3000) -> str:
    """Truncate text to a max length, preserving word boundaries."""
    if not text or len(text) <= max_chars:
        return text or ""
    truncated = text[:max_chars]
    # Cut at last space to avoid mid-word breaks
    last_space = truncated.rfind(" ")
    if last_space > max_chars * 0.8:
        truncated = truncated[:last_space]
    return truncated + "..."


def detect_newsletter_source(subject: str, sender: str) -> str | None:
    """
    Determine which TLDR newsletter this is based on subject and sender.
    Returns 'founders', 'fintech', 'crypto', or None.
    """
    subject_lower = (subject or "").lower()
    sender_lower = (sender or "").lower()

    if "founder" in subject_lower or "founder" in sender_lower:
        return "founders"
    if "fintech" in subject_lower or "fintech" in sender_lower:
        return "fintech"
    if "crypto" in subject_lower or "crypto" in sender_lower:
        return "crypto"
    # Fallback: check if it's from a known TLDR sender at all
    if "tldr" in sender_lower:
        # Try to infer from subject keywords
        if any(kw in subject_lower for kw in ["founder", "startup", "raise", "vc"]):
            return "founders"
        if any(kw in subject_lower for kw in ["fintech", "bank", "payment"]):
            return "fintech"
        if any(kw in subject_lower for kw in ["crypto", "bitcoin", "defi", "web3", "token"]):
            return "crypto"
    return None


def strip_html(html: str) -> str:
    """Very basic HTML tag stripping."""
    return re.sub(r"<[^>]+>", " ", html or "").strip()


def now_utc() -> datetime:
    """Current UTC datetime."""
    return datetime.now(timezone.utc)
