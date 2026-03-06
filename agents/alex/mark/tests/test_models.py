"""
Tests for database models.
Uses an in-memory SQLite database for isolation.
"""

import unittest
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.utils.models import (
    Base, Newsletter, NewsletterItem, EnrichedLink,
    Category, TrendSnapshot, Entity, DailySummary,
    item_category,
)


class TestModels(unittest.TestCase):
    """Test SQLAlchemy models and relationships."""

    @classmethod
    def setUpClass(cls):
        """Create in-memory database for tests."""
        cls.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(cls.engine)
        cls.Session = sessionmaker(bind=cls.engine)

    def setUp(self):
        self.session = self.Session()

    def tearDown(self):
        self.session.rollback()
        self.session.close()

    def test_create_newsletter(self):
        nl = Newsletter(
            message_id="test-123",
            source="crypto",
            subject="TLDR Crypto 2024-01-15",
            date=datetime(2024, 1, 15, tzinfo=timezone.utc),
        )
        self.session.add(nl)
        self.session.flush()
        self.assertIsNotNone(nl.id)
        self.assertEqual(nl.source, "crypto")

    def test_create_newsletter_item(self):
        nl = Newsletter(
            message_id="test-456",
            source="fintech",
            subject="TLDR Fintech",
            date=datetime(2024, 1, 15, tzinfo=timezone.utc),
        )
        self.session.add(nl)
        self.session.flush()

        item = NewsletterItem(
            newsletter_id=nl.id,
            headline="Stripe launches stablecoin payments",
            summary="Major payments infrastructure update",
            url="https://example.com/stripe",
            section="Headlines",
            position=1,
        )
        self.session.add(item)
        self.session.flush()

        self.assertIsNotNone(item.id)
        self.assertEqual(item.newsletter.source, "fintech")

    def test_item_category_relationship(self):
        nl = Newsletter(
            message_id="test-789",
            source="founders",
            subject="TLDR Founders",
            date=datetime(2024, 1, 15, tzinfo=timezone.utc),
        )
        self.session.add(nl)
        self.session.flush()

        item = NewsletterItem(
            newsletter_id=nl.id,
            headline="Test headline",
        )
        cat = Category(name="stablecoins", display_name="Stablecoins")
        self.session.add_all([item, cat])
        self.session.flush()

        # Create many-to-many link
        self.session.execute(
            item_category.insert().values(item_id=item.id, category_id=cat.id)
        )
        self.session.flush()

        # Verify relationship
        self.assertIn(cat, item.categories)
        self.assertIn(item, cat.items)

    def test_enriched_link(self):
        nl = Newsletter(
            message_id="test-link-1",
            source="crypto",
            subject="Test",
            date=datetime(2024, 1, 15, tzinfo=timezone.utc),
        )
        self.session.add(nl)
        self.session.flush()

        item = NewsletterItem(newsletter_id=nl.id, headline="Test")
        self.session.add(item)
        self.session.flush()

        link = EnrichedLink(
            item_id=item.id,
            url="https://example.com/article",
            fetch_status="pending",
        )
        self.session.add(link)
        self.session.flush()

        self.assertEqual(link.fetch_status, "pending")
        self.assertEqual(link.item.headline, "Test")

    def test_trend_snapshot(self):
        cat = Category(name="test_cat")
        self.session.add(cat)
        self.session.flush()

        snap = TrendSnapshot(
            category_id=cat.id,
            snapshot_date=datetime(2024, 1, 15, tzinfo=timezone.utc),
            window_days=7,
            mention_count=15,
            avg_importance=7.5,
            momentum_score=0.25,
        )
        self.session.add(snap)
        self.session.flush()

        self.assertEqual(snap.mention_count, 15)
        self.assertEqual(snap.momentum_score, 0.25)

    def test_duplicate_message_id_rejected(self):
        nl1 = Newsletter(
            message_id="dup-test",
            source="crypto",
            subject="Test 1",
            date=datetime(2024, 1, 15, tzinfo=timezone.utc),
        )
        self.session.add(nl1)
        self.session.flush()

        nl2 = Newsletter(
            message_id="dup-test",
            source="crypto",
            subject="Test 2",
            date=datetime(2024, 1, 16, tzinfo=timezone.utc),
        )
        self.session.add(nl2)

        with self.assertRaises(Exception):
            self.session.flush()


if __name__ == "__main__":
    unittest.main()
