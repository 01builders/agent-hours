#!/usr/bin/env python3
"""
Zero Human Corp — Economic Tracker
Tracks revenue, costs, and generates P&L reports.
Reads from memory files, writes reports to economy/reports/
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

MEMORY_DIR = Path("./memory")
REPORTS_DIR = Path("./economy/reports")
BUDGET_FILE = Path("./economy/budget.json")
REVENUE_LOG = MEMORY_DIR / "revenue-log.md"
COMPANY_STATE = MEMORY_DIR / "company-state.md"


def load_budget():
    with open(BUDGET_FILE) as f:
        return json.load(f)


def parse_revenue_log():
    """Parse revenue-log.md for transaction entries."""
    if not REVENUE_LOG.exists():
        return [], []

    revenues = []
    costs = []

    with open(REVENUE_LOG) as f:
        for line in f:
            line = line.strip()
            if line.startswith("- REVENUE:"):
                parts = line.split("|")
                if len(parts) >= 3:
                    amount = float(parts[0].split("$")[1].strip())
                    source = parts[1].strip()
                    timestamp = parts[2].strip()
                    revenues.append({"amount": amount, "source": source, "timestamp": timestamp})
            elif line.startswith("- COST:"):
                parts = line.split("|")
                if len(parts) >= 3:
                    amount = float(parts[0].split("$")[1].strip())
                    category = parts[1].strip()
                    timestamp = parts[2].strip()
                    costs.append({"amount": amount, "category": category, "timestamp": timestamp})

    return revenues, costs


def generate_report():
    """Generate an hourly P&L report."""
    budget = load_budget()
    revenues, costs = parse_revenue_log()

    total_revenue = sum(r["amount"] for r in revenues)
    total_costs = sum(c["amount"] for c in costs)
    net_pnl = total_revenue - total_costs

    now = datetime.now(timezone.utc)
    report_name = f"report-{now.strftime('%Y%m%d-%H%M')}.md"

    # Revenue by source
    revenue_by_source = {}
    for r in revenues:
        src = r["source"]
        revenue_by_source[src] = revenue_by_source.get(src, 0) + r["amount"]

    # Costs by category
    costs_by_category = {}
    for c in costs:
        cat = c["category"]
        costs_by_category[cat] = costs_by_category.get(cat, 0) + c["amount"]

    # Budget utilization
    daily_spend = sum(c["amount"] for c in costs)  # simplified
    budget_util = daily_spend / budget["dailyBudgetLimit"] * 100 if budget["dailyBudgetLimit"] > 0 else 0

    report = f"""# P&L Report — {now.strftime('%Y-%m-%d %H:%M UTC')}

## Summary
| Metric | Value |
|--------|-------|
| Total Revenue | ${total_revenue:.2f} |
| Total Costs | ${total_costs:.2f} |
| Net P&L | ${net_pnl:.2f} |
| Budget Utilization | {budget_util:.1f}% |
| Transactions | {len(revenues)} revenue, {len(costs)} cost |

## Revenue by Source
"""
    for src, amt in sorted(revenue_by_source.items(), key=lambda x: -x[1]):
        report += f"- {src}: ${amt:.2f}\n"

    if not revenue_by_source:
        report += "- No revenue yet\n"

    report += "\n## Costs by Category\n"
    for cat, amt in sorted(costs_by_category.items(), key=lambda x: -x[1]):
        report += f"- {cat}: ${amt:.2f}\n"

    if not costs_by_category:
        report += "- No costs yet\n"

    report += f"""
## Status
{"🟢 PROFITABLE" if net_pnl > 0 else "🔴 NOT YET PROFITABLE" if net_pnl == 0 else "🟡 RUNNING AT LOSS"}

## Budget Alerts
{"⚠️ WARNING: Budget utilization > 80%!" if budget_util > 80 else "✅ Budget within limits"}
"""

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORTS_DIR / report_name
    with open(report_path, "w") as f:
        f.write(report)

    print(f"Report generated: {report_path}")
    return report_path


if __name__ == "__main__":
    generate_report()
