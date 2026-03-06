"""
Tests for the newsletter parser.
"""

import unittest
from src.ingestion.parser import parse_newsletter_html, parse_newsletter_text, ParsedItem


class TestParseNewsletterHTML(unittest.TestCase):
    """Test HTML newsletter parsing."""

    SAMPLE_HTML = """
    <html>
    <body>
    <table>
    <tr><td>
        <h2>📊 BIG TECH & STARTUPS</h2>
    </td></tr>
    <tr><td>
        <a href="https://example.com/article1">Stripe Launches Stablecoin Support for USDC Payments</a>
        <p>Stripe announced native support for USDC stablecoin payments across its
        merchant network. This expands crypto payment options for mainstream businesses
        and signals growing institutional interest in stablecoin rails.</p>
    </td></tr>
    <tr><td>
        <a href="https://example.com/article2">Circle Files for IPO Amid Stablecoin Boom</a>
        <p>Circle, the issuer of USDC, has filed for an initial public offering.
        The move comes as stablecoin transaction volumes hit all-time highs.</p>
    </td></tr>
    <tr><td>
        <h2>🚀 QUICK LINKS</h2>
    </td></tr>
    <tr><td>
        <a href="https://example.com/article3">New Wallet Standard Proposed by Ethereum Foundation</a>
        <p>A new wallet interoperability standard aims to reduce fragmentation.</p>
    </td></tr>
    </table>
    </body>
    </html>
    """

    def test_parses_items_from_html(self):
        result = parse_newsletter_html(self.SAMPLE_HTML)
        self.assertGreater(len(result.items), 0, "Should parse at least one item")

    def test_extracts_links(self):
        result = parse_newsletter_html(self.SAMPLE_HTML)
        self.assertGreater(len(result.all_links), 0, "Should extract article links")
        # Should not include internal TLDR links
        for link in result.all_links:
            self.assertNotIn("tldr", link.lower())

    def test_items_have_headlines(self):
        result = parse_newsletter_html(self.SAMPLE_HTML)
        for item in result.items:
            self.assertTrue(len(item.headline) > 0, "Each item should have a headline")

    def test_items_have_urls(self):
        result = parse_newsletter_html(self.SAMPLE_HTML)
        items_with_urls = [i for i in result.items if i.url]
        self.assertGreater(len(items_with_urls), 0, "At least some items should have URLs")

    def test_empty_html_returns_empty(self):
        result = parse_newsletter_html("")
        self.assertEqual(len(result.items), 0)
        self.assertEqual(len(result.all_links), 0)

    def test_handles_malformed_html(self):
        result = parse_newsletter_html("<div><a href='http://x.com/test'>broken")
        # Should not crash
        self.assertIsNotNone(result)


class TestParseNewsletterText(unittest.TestCase):
    """Test plain-text newsletter parsing."""

    SAMPLE_TEXT = """
    TLDR Crypto 2024-01-15

    BIG TECH & STARTUPS

    Stripe Launches Stablecoin Support
    https://example.com/stripe-stablecoin

    Stripe announced native USDC support for merchants.
    This is a big deal for crypto payments adoption.

    Circle Files for IPO
    https://example.com/circle-ipo

    Circle has filed S-1 paperwork for an IPO.
    """

    def test_parses_text_items(self):
        result = parse_newsletter_text(self.SAMPLE_TEXT)
        self.assertGreater(len(result.items), 0)

    def test_extracts_urls_from_text(self):
        result = parse_newsletter_text(self.SAMPLE_TEXT)
        self.assertGreater(len(result.all_links), 0)

    def test_empty_text_returns_empty(self):
        result = parse_newsletter_text("")
        self.assertEqual(len(result.items), 0)


if __name__ == "__main__":
    unittest.main()
