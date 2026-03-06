"""
Categorization engine for Mark.
Assigns strategy-relevant theme tags to newsletter items using the LLM.

Categories are NOT a fixed closed list — new themes can emerge over time.
The LLM is given a seed list of known themes and can suggest new ones.

Usage:
    Called from run_analysis.py
"""

import json
from sqlalchemy import and_

from src.utils.logger import get_logger
from src.utils.models import NewsletterItem, Category, EnrichedLink, item_category, get_session
from src.utils.llm import call_llm_json, load_prompt

logger = get_logger("mark.categorizer")

# Seed categories — Mark starts with these but can create new ones
SEED_CATEGORIES = [
    ("stablecoins", "Stablecoins", "Stablecoin issuance, regulation, adoption, and infrastructure"),
    ("payments", "Payments", "Payment rails, processors, cross-border payments, remittances"),
    ("onchain_identity", "Onchain Identity", "Identity, KYC, verifiable credentials, reputation systems"),
    ("wallets", "Wallets", "Wallet infrastructure, UX, account abstraction, key management"),
    ("custody", "Custody", "Asset custody, institutional storage, MPC, key management services"),
    ("tokenization", "Tokenization", "Real-world asset tokenization, securities, commodities on-chain"),
    ("compliance_tooling", "Compliance Tooling", "RegTech, AML, sanctions screening, reporting tools"),
    ("institutional_adoption", "Institutional Adoption", "Banks, funds, enterprises entering crypto/Web3"),
    ("developer_tooling", "Developer Tooling", "SDKs, APIs, dev platforms, smart contract tools"),
    ("consumer_ux", "Consumer UX", "Consumer-facing products, onboarding, mainstream UX"),
    ("crossborder_infra", "Cross-Border Infra", "Cross-border settlement, FX, international corridors"),
    ("ai_crypto", "AI x Crypto", "Intersection of AI and crypto/Web3, AI agents, compute markets"),
    ("security", "Security", "Smart contract security, audits, hacks, exploit prevention"),
    ("defi_infra", "DeFi Infra", "DeFi protocols, liquidity, lending, DEXs, yield infrastructure"),
    ("fintech_rails", "Fintech Rails", "Banking-as-a-service, embedded finance, neobanks, APIs"),
    ("founder_behavior", "Founder Behavior", "Founder strategies, fundraising patterns, hiring, pivots"),
    ("m_and_a", "M&A / Consolidation", "Acquisitions, mergers, consolidation patterns, roll-ups"),
    ("enterprise_adoption", "Enterprise Adoption", "Enterprise blockchain/crypto use cases, pilots, production"),
    ("governance", "Governance", "DAO governance, protocol governance, corporate governance"),
    ("market_structure", "Market Structure", "Exchange infrastructure, trading, market making, clearing"),
    ("data_analytics", "Data / Analytics", "On-chain analytics, data infrastructure, indexing"),
    ("interoperability", "Interoperability", "Bridges, cross-chain protocols, multi-chain coordination"),
    ("distribution", "Distribution", "Go-to-market, distribution strategies, partnerships, growth"),
    ("emerging_sectors", "Emerging Sectors", "New categories not yet established, early-stage trends"),
    ("regulation", "Regulation", "Policy, legislation, regulatory frameworks, enforcement actions"),
]


def ensure_seed_categories(session):
    """Create seed categories if they don't exist."""
    existing = {c.name for c in session.query(Category).all()}
    for name, display_name, description in SEED_CATEGORIES:
        if name not in existing:
            session.add(Category(name=name, display_name=display_name, description=description))
    session.commit()


def categorize_uncategorized_items(batch_size: int = 20):
    """
    Find items without categories and categorize them using the LLM.
    Processes in batches to reduce API calls.
    """
    session = get_session()
    ensure_seed_categories(session)

    # Get all current category names for the prompt
    all_categories = session.query(Category).all()
    category_names = [c.name for c in all_categories]
    category_map = {c.name: c.id for c in all_categories}

    # Find uncategorized items (items with no category links)
    categorized_ids = {
        row[0] for row in session.execute(
            item_category.select().with_only_columns(item_category.c.item_id)
        ).fetchall()
    }

    uncategorized = (
        session.query(NewsletterItem)
        .filter(~NewsletterItem.id.in_(categorized_ids) if categorized_ids else True)
        .limit(batch_size * 5)
        .all()
    )

    if not uncategorized:
        logger.info("All items are categorized.")
        return 0

    logger.info(f"Categorizing {len(uncategorized)} items...")

    # Process in batches
    categorized_count = 0
    for i in range(0, len(uncategorized), batch_size):
        batch = uncategorized[i:i + batch_size]

        # Build batch context
        items_text = []
        for item in batch:
            # Include enriched link summary if available
            link_summary = ""
            if item.link and item.link.page_summary:
                link_summary = f" | Link summary: {item.link.page_summary[:200]}"

            items_text.append(
                f"ID:{item.id} | {item.headline} | {item.summary[:200] if item.summary else ''}{link_summary}"
            )

        prompt_template = load_prompt("categorize.txt")
        prompt = prompt_template.format(
            category_list=", ".join(category_names),
            items_text="\n".join(items_text),
        )

        result = call_llm_json(prompt)

        if not isinstance(result, list):
            logger.warning(f"Unexpected categorization result type: {type(result)}")
            continue

        for entry in result:
            item_id = entry.get("id")
            categories = entry.get("categories", [])

            if not item_id or not categories:
                continue

            for cat_name in categories:
                cat_name = cat_name.lower().strip().replace(" ", "_")

                # Create new category if LLM suggests one we don't have
                if cat_name not in category_map:
                    new_cat = Category(
                        name=cat_name,
                        display_name=cat_name.replace("_", " ").title(),
                    )
                    session.add(new_cat)
                    session.flush()
                    category_map[cat_name] = new_cat.id
                    logger.info(f"New category emerged: {cat_name}")

                # Link item to category (avoid duplicates)
                try:
                    session.execute(
                        item_category.insert().values(
                            item_id=item_id,
                            category_id=category_map[cat_name],
                        )
                    )
                    categorized_count += 1
                except Exception:
                    session.rollback()
                    continue

        session.commit()

    session.close()
    logger.info(f"Categorization complete. {categorized_count} category assignments made.")
    return categorized_count


if __name__ == "__main__":
    count = categorize_uncategorized_items()
    print(f"✓ Made {count} category assignments.")
