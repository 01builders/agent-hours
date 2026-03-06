# Skill: Idea Discovery & Validation Framework

## Overview

This is the CEO's structured process for discovering, evaluating, and executing on revenue ideas.
It runs as a pipeline: DISCOVER → SCORE → VALIDATE → BUILD → MEASURE → SCALE or KILL.

---

## Phase 1: DISCOVER (30 min)

### Method: Contrarian Opportunity Scan

Don't ask "what's popular?" Ask "what's annoying, broken, or missing?"

#### Search Queries to Run
Execute these web searches and analyze results:

1. **Pain Point Mining**
   - `"I wish there was a tool that" site:reddit.com [niche]`
   - `"paying too much for" site:reddit.com`
   - `"there should be an app" site:twitter.com`
   - `"frustrated with" [industry] software`

2. **Underserved Niche Detection**
   - `[tiny industry] + "no good software"`
   - `[boring vertical] + "still using spreadsheets"`
   - `small business + [process] + "manual" + "automate"`

3. **Arbitrage Opportunities**
   - Public data that's hard to access or parse (government, academic, regulatory)
   - Information locked in PDFs, spreadsheets, or legacy systems
   - Price comparison gaps in niche markets
   - API aggregation (combine 3 free APIs into 1 premium product)

4. **AI-Native Advantages**
   - Tasks where AI is 10x faster than humans (research, data processing, content)
   - Tasks where speed of delivery is the moat (real-time analysis, instant reports)
   - Tasks where personalization at scale matters (custom reports per customer)

### Output: Idea List
Generate 10-15 raw ideas. For each:
```
IDEA: [one-line description]
PAIN: [what problem does it solve?]
WHO: [who pays for this?]
HOW: [how do we charge?]
WHY_US: [why is an AI company uniquely suited?]
```

---

## Phase 2: SCORE (15 min)

### Scoring Matrix (1-5 each, minimum 18/30 to proceed)

| Criteria | 1 (Bad) | 3 (OK) | 5 (Great) |
|----------|---------|--------|-----------|
| **Pain Severity** | Nice-to-have | Saves time | Saves money or prevents loss |
| **Market Size** | < 100 potential customers | 100-10K customers | 10K+ customers |
| **Build Speed** | > 1 week | 1-3 days | < 4 hours to MVP |
| **Revenue Speed** | Months to first $ | Weeks to first $ | Days or hours to first $ |
| **AI Moat** | Anyone can copy | Some differentiation | Deep AI advantage |
| **Recurring** | One-time purchase | Repeated purchases | Monthly subscription |

### Scoring Rules
- Be brutally honest. If in doubt, score lower.
- Two ideas scoring 25+ is better than five ideas scoring 18.
- Revenue Speed is the most important criterion for a hackathon.

---

## Phase 3: VALIDATE (1-2 hours)

### Quick Validation Methods (pick 1-2 per idea)

#### A. Landing Page Test
- CTO builds a landing page in 30 min (HTML + Tailwind + Stripe link)
- Deploy to Cloudflare Pages
- BizDev posts link to 2-3 relevant communities (Reddit, HN, Twitter)
- Measure: clicks, signups, payment attempts within 2 hours

#### B. Pre-sell Test
- BizDev creates a compelling offer description
- Direct outreach to 10 potential customers (email, DM, community post)
- Ask: "Would you pay $X/mo for this?"
- Measure: response rate, positive intent, actual pre-orders

#### C. Competitor Gap Analysis
- Find 3 existing solutions
- Identify what they do badly or don't do at all
- Build ONLY the gap (not the whole product)
- Price at 50% of competitors for entry

#### D. "Build It Live" Test
- Start building the MVP
- If it takes > 2 hours for the core feature, pivot to simpler version
- Ship whatever works, even if ugly
- Measure: can someone actually USE this and would they PAY?

---

## Phase 4: BUILD (2-4 hours)

### Delegation to CTO (Hackerman)

```
TASK: Build MVP for [product name]
CONTEXT: Scored [X/30] in idea evaluation. Validated via [method].
SPEC:
  - Core feature: [the ONE thing it does]
  - Stack: [recommended from rapid-prototyper skill]
  - Payment: Stripe Checkout link at $[price]/mo
  - Landing: Single page with value prop + CTA
  - Deploy: Cloudflare Pages at [name].pages.dev
SUCCESS_METRIC: Deployed, functional, accepting payments within [X] hours
DEADLINE: [timestamp]
BUDGET: $0 (use free tiers only for MVP)
```

### Parallel Delegation to BizDev (Borat)

```
TASK: Prepare launch for [product name]
CONTEXT: CTO is building MVP. Need distribution ready when it ships.
SPEC:
  - Write 3 different launch posts (Reddit, HN, Twitter)
  - Identify 5 communities where target customers hang out
  - Prepare a cold outreach template for 10 prospects
  - Draft a Product Hunt launch page (if applicable)
SUCCESS_METRIC: Launch content ready, distribution channels identified
DEADLINE: Same as CTO deadline
BUDGET: $0
```

---

## Phase 5: MEASURE (first 24 hours)

### Metrics to Track (Ops agent)

| Metric | Good | Bad | Kill Signal |
|--------|------|-----|-------------|
| Landing page visits | > 50 | < 10 | < 5 after launch |
| Signup/email capture | > 5% conversion | < 1% | 0 signups |
| Payment attempts | Any > 0 | 0 | 0 after 24h |
| Actual revenue | Any > $0 | $0 | $0 after 48h |
| Customer feedback | Positive | Meh | Negative |
| Organic shares | > 0 | 0 | N/A |

### Decision Points
- **6 hours post-launch**: Check traffic. No traffic = distribution problem, not product problem. Fix distribution.
- **12 hours**: Check signups/interest. No interest = messaging problem or wrong market. Pivot messaging.
- **24 hours**: Check revenue. No revenue = pricing problem or product problem. Try lower price first.
- **48 hours**: If still $0 revenue, KILL and move to next idea.

---

## Phase 6: SCALE or KILL

### SCALE (if revenue > $0)
1. Identify what's working (which channel, which message, which feature)
2. Double down on the working channel
3. CTO: Fix top 3 user-reported issues
4. BizDev: 10x the outreach on the winning channel
5. CEO: Consider raising prices (if people paid $10, try $20)

### KILL (if no revenue after 48h)
1. Log what was learned in `memory/learnings.md`
2. Ask: Was it the idea, the execution, the distribution, or the pricing?
3. If idea was good but execution was bad → retry with different approach
4. If idea was bad → move to next highest-scoring idea from Phase 2
5. Reallocate all agents to new idea immediately

---

## Meta-Strategy: Portfolio Approach

Don't bet everything on one idea. Run 2-3 in parallel:
- **Idea A** (highest score): Full build + launch
- **Idea B** (second highest): Landing page validation only
- **Idea C** (third highest): Quick research + competitor analysis

If A fails, B is already partially validated and ready to build.
If A succeeds, keep B on the backburner for diversification.

---

## Example Ideas by Category (Starting Points, NOT Prescriptions)

### Data Products
- Structured datasets from messy public sources (government filings, SEC, patents)
- Automated competitive intelligence reports for specific verticals
- Real-time aggregation of niche market data (e.g., indie game sales, craft beer prices)

### Micro-SaaS
- Automated compliance checkers for specific regulations (GDPR for small sites, ADA)
- Niche CRM for underserved industries (tattoo shops, pet groomers, music teachers)
- Automated report generators (turn raw data into branded PDF reports)

### Content Businesses
- Hyper-niche newsletters with sponsorship monetization
- Automated SEO content farms for long-tail keywords with affiliate revenue
- AI-curated reading lists for specific professional roles

### Service Arbitrage
- Automated code reviews / security audits sold as a service
- Instant market research reports for small business decisions
- Automated social media management for very specific niches

### Tool Arbitrage
- Combine 3 free APIs into 1 premium, easy-to-use product
- Build a beautiful UI on top of an ugly-but-powerful open source tool
- Chrome extensions that solve one specific workflow pain
