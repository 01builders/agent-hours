"""
ClawWork-inspired Economic Accountability Tracker

Tracks per-agent costs and revenue in append-only JSONL files.
Inspired by HKUDS/ClawWork's economic survival framework.

Every agent action has a measurable cost, every output has a measurable value.
Agents must maintain solvency — the company tracks everything.
"""

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

COSTS_FILE = Path(os.environ.get("ZHC_ROOT", ".")) / "economy" / "costs.jsonl"
BALANCE_FILE = Path(os.environ.get("ZHC_ROOT", ".")) / "economy" / "balance.jsonl"

# Approximate token costs per provider ($/1K tokens)
TOKEN_COSTS = {
    "claude-opus-4-6": {"input": 0.015, "output": 0.075},
    "claude-sonnet-4-6": {"input": 0.003, "output": 0.015},
    "gpt-5.3-codex": {"input": 0.01, "output": 0.03},
    "o3": {"input": 0.01, "output": 0.04},
}

# Survival tiers (from ClawWork)
TIERS = {
    "thriving": 100.0,    # > $100 net
    "stable": 10.0,       # > $10 net
    "struggling": 0.0,    # > $0 net
    "bankrupt": -float("inf"),  # negative
}


def _append_jsonl(path, record):
    """Append a JSON record to a JSONL file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as f:
        f.write(json.dumps(record) + "\n")


def log_cost(agent_id, model, input_tokens=0, output_tokens=0, task_id=None, description=""):
    """Log a token cost for an agent."""
    costs = TOKEN_COSTS.get(model, {"input": 0.01, "output": 0.03})
    cost = (input_tokens / 1000 * costs["input"]) + (output_tokens / 1000 * costs["output"])

    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "type": "cost",
        "agent": agent_id,
        "model": model,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "cost": round(cost, 6),
        "taskId": task_id,
        "description": description,
    }
    _append_jsonl(COSTS_FILE, record)
    return cost


def log_revenue(amount, source, agent_id=None, task_id=None, description=""):
    """Log revenue earned."""
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "type": "revenue",
        "agent": agent_id,
        "amount": round(amount, 2),
        "source": source,
        "taskId": task_id,
        "description": description,
    }
    _append_jsonl(COSTS_FILE, record)
    return amount


def get_agent_costs(agent_id=None):
    """Get total costs, optionally filtered by agent."""
    total = 0.0
    if not COSTS_FILE.exists():
        return total
    with open(COSTS_FILE) as f:
        for line in f:
            try:
                r = json.loads(line.strip())
                if r["type"] == "cost":
                    if agent_id is None or r.get("agent") == agent_id:
                        total += r.get("cost", 0)
            except (json.JSONDecodeError, KeyError):
                continue
    return round(total, 6)


def get_total_revenue():
    """Get total revenue across all agents."""
    total = 0.0
    if not COSTS_FILE.exists():
        return total
    with open(COSTS_FILE) as f:
        for line in f:
            try:
                r = json.loads(line.strip())
                if r["type"] == "revenue":
                    total += r.get("amount", 0)
            except (json.JSONDecodeError, KeyError):
                continue
    return round(total, 2)


def get_survival_tier():
    """Get current survival tier (ClawWork-inspired)."""
    net = get_total_revenue() - get_agent_costs()
    for tier, threshold in TIERS.items():
        if net >= threshold:
            return tier, round(net, 2)
    return "bankrupt", round(net, 2)


def snapshot_balance():
    """Take a balance snapshot (for time-series tracking)."""
    costs = get_agent_costs()
    revenue = get_total_revenue()
    tier, net = get_survival_tier()

    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "totalCosts": round(costs, 2),
        "totalRevenue": round(revenue, 2),
        "net": round(net, 2),
        "tier": tier,
    }
    _append_jsonl(BALANCE_FILE, record)
    return record
