# Skill: Revenue Opportunity Scanner

## When to Use
During every heartbeat cycle, and whenever the company needs a new revenue stream.

## Process

### 1. Market Scan
Use web search to identify:
- Trending niches with high demand and low supply
- Pain points in specific industries that AI can solve 10x faster
- Emerging markets where first-mover advantage is massive
- Price points that small businesses actually pay

### 2. Opportunity Evaluation
For each opportunity, score 1-5 on:

| Criteria | Question |
|----------|----------|
| TAM | Is there a real market? |
| Speed | Can we ship in < 4 hours? |
| Revenue Path | How quickly can we charge? |
| Moat | How defensible is this? |
| AI Fit | Is this 10x better done by AI? |

**Minimum threshold: 15/25 to pursue.**

### 3. Creative Filters
Prefer opportunities that are:
- **Novel**: Nobody else is doing this with AI agents
- **Recurring**: Subscription > one-time
- **Scalable**: Marginal cost near zero
- **Invisible**: Markets humans overlook because they're too small or boring
- **Compounding**: Gets better the more data/users you have

### 4. Decision
- Score >= 20: PURSUE IMMEDIATELY, assign to CTO + BizDev
- Score 15-19: EXPLORE, assign to BizDev for validation
- Score < 15: PASS, log reasoning in decisions.md

### 5. Log Everything
Write to `memory/decisions.md`:
```
## [Timestamp] Revenue Opportunity: [Name]
- Score: X/25
- Decision: PURSUE / EXPLORE / PASS
- Reasoning: [Why]
- Assigned to: [Agent] or N/A
```
