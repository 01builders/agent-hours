"""
Tests for the scoring framework logic.
Tests the scoring prompt design and helper functions.
"""

import unittest
from src.utils.helpers import (
    detect_newsletter_source, clean_url, url_domain,
    safe_truncate, hash_text,
)


class TestDetectNewsletterSource(unittest.TestCase):
    """Test newsletter source detection from email headers."""

    def test_detects_founders(self):
        self.assertEqual(
            detect_newsletter_source("TLDR Founders 2024-01-15", "founders@tldrnewsletter.com"),
            "founders"
        )

    def test_detects_fintech(self):
        self.assertEqual(
            detect_newsletter_source("TLDR Fintech 2024-01-15", "fintech@tldrnewsletter.com"),
            "fintech"
        )

    def test_detects_crypto(self):
        self.assertEqual(
            detect_newsletter_source("TLDR Crypto 2024-01-15", "crypto@tldrnewsletter.com"),
            "crypto"
        )

    def test_detects_from_subject_only(self):
        self.assertEqual(
            detect_newsletter_source("TLDR Crypto Daily", "unknown@example.com"),
            None  # sender doesn't match TLDR
        )

    def test_returns_none_for_unknown(self):
        self.assertIsNone(
            detect_newsletter_source("Weekly Sales Report", "boss@company.com")
        )

    def test_case_insensitive(self):
        self.assertEqual(
            detect_newsletter_source("tldr founders daily", "FOUNDERS@TLDRNEWSLETTER.COM"),
            "founders"
        )


class TestCleanUrl(unittest.TestCase):
    """Test URL cleaning."""

    def test_strips_tracking_params(self):
        result = clean_url("https://example.com/article?utm_source=twitter&ref=123")
        self.assertEqual(result, "https://example.com/article")

    def test_handles_empty(self):
        self.assertEqual(clean_url(""), "")

    def test_preserves_path(self):
        result = clean_url("https://example.com/blog/post-title")
        self.assertEqual(result, "https://example.com/blog/post-title")


class TestUrlDomain(unittest.TestCase):
    """Test domain extraction."""

    def test_extracts_domain(self):
        self.assertEqual(url_domain("https://www.example.com/page"), "www.example.com")

    def test_handles_empty(self):
        self.assertEqual(url_domain(""), "")


class TestSafeTruncate(unittest.TestCase):
    """Test text truncation."""

    def test_short_text_unchanged(self):
        self.assertEqual(safe_truncate("hello", 100), "hello")

    def test_truncates_long_text(self):
        long_text = "word " * 1000
        result = safe_truncate(long_text, 50)
        self.assertLessEqual(len(result), 60)  # ~50 + "..."

    def test_handles_none(self):
        self.assertEqual(safe_truncate(None, 100), "")


class TestHashText(unittest.TestCase):
    """Test text hashing for dedup."""

    def test_consistent_hash(self):
        self.assertEqual(hash_text("hello"), hash_text("hello"))

    def test_different_inputs_different_hash(self):
        self.assertNotEqual(hash_text("hello"), hash_text("world"))

    def test_returns_short_hash(self):
        result = hash_text("test string")
        self.assertEqual(len(result), 16)


if __name__ == "__main__":
    unittest.main()
