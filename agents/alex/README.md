# Agent Submission

## Author

Alex

## Agent Name

Mark

## One-Line Description

A strategic news synthesizer that reads TLDR Founders/Fintech/Crypto newsletters and generates executive briefings for a crypto/Web3 Chief Strategy Officer.

## What job does this agent own?

Mark owns the daily intelligence loop for a strategy leader. It ingests TLDR newsletter emails via IMAP, extracts and enriches linked articles, categorizes content into strategy-relevant themes (stablecoins, payments, compliance, M&A, developer tooling, etc.), scores items by strategic importance (not hype), tracks trend momentum across 7/30/90-day windows, and generates daily executive briefings and weekly strategic memos. It also surfaces "Read This Now" standout items and produces actionable recommendations around product opportunities, roadmap direction, positioning, and acquisition signals.

## Why should this be an agent?

This workflow is a real time sink when done manually. A CSO would need to read 3 newsletters daily, click through dozens of links, mentally track which themes are recurring vs fading, and synthesize it all into actionable insight. That's 30-60 minutes per day of reading before any strategic thinking happens. Mark compresses that into a 1-2 minute briefing. It also does something humans are bad at consistently: tracking momentum and decay of themes over weeks and months, and separating "talked about a lot" from "actually strategically important."

## What tools does the agent use?

- **IMAP** — connects to a dedicated email inbox to pull newsletter emails
- **BeautifulSoup + readability-lxml** — parses newsletter HTML and extracts readable content from linked articles
- **Anthropic Claude API (claude-sonnet-4-20250514)** — categorizes items, scores strategic importance, summarizes linked articles, generates briefings and memos
- **SQLite + SQLAlchemy** — stores newsletters, items, links, categories, trend snapshots, and generated outputs
- **Streamlit** — dashboard for visualizing themes, trends, standout items, and recommendations
- **Plotly** — interactive charts for theme momentum, importance, and attention vs importance scatter plots

## What framework or stack did you use?

Python 3.11, no agent framework. Pure Python with: SQLAlchemy (ORM), Streamlit (dashboard), Anthropic SDK (LLM), BeautifulSoup + readability-lxml (parsing), Plotly (charts), Pandas (data handling). SQLite for storage. Local-first, runs on a laptop with a cron job.

## What are the boundaries?

- **What can it do automatically?**
  - Ingest new newsletter emails from IMAP
  - Parse newsletters into structured items
  - Fetch and summarize linked articles
  - Categorize items into strategy-relevant themes
  - Score items on strategic importance and attention volume
  - Track trend momentum across time windows
  - Generate daily briefings and weekly memos
  - Flag standout "Read This Now" items

- **What requires human approval?**
  - Acting on any recommendation (product, roadmap, M&A, positioning)
  - Sharing briefings externally
  - Adding new newsletter sources beyond the three TLDR newsletters

- **What should make it stop or escalate?**
  - If IMAP login fails (config problem — needs human to fix credentials)
  - If Anthropic API rate limits are hit repeatedly (backs off automatically, but flags it)
  - If zero newsletters are found for multiple days (likely a subscription or inbox issue)

## How do you evaluate it?

1. **Does it connect and ingest?** — Run `python3 -m src.ingestion.ingest` and confirm newsletters are pulled and parsed without errors.
2. **Does enrichment work?** — Run `python3 -m src.ingestion.enrich_links` and confirm linked articles are fetched and summarized.
3. **Are categorizations reasonable?** — Check the dashboard's Themes view and verify items are tagged with sensible categories.
4. **Are importance scores defensible?** — Each scored item includes a written explanation. Review a sample of 10 items and check whether the explanation matches the score.
5. **Is the briefing useful?** — Read the daily briefing and ask: could I skip reading the newsletters today and still know what matters? If yes, it's working.
6. **Do trends track over time?** — After 1-2 weeks of data, check that the momentum charts reflect reality (e.g., a topic that dominated the news should show as "surging").

## What level is this agent?

**Level 2 — Autonomous executor with defined scope.** Mark runs its full pipeline without human intervention (ingest → analyze → brief), but operates within strict boundaries: only reads three specific newsletters, only follows links inside those newsletters, and only outputs analysis — never takes action on behalf of the user.

## Demo / How to Run
```bash
# Setup (one-time)
cd agents/alex/mark
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your IMAP credentials and Anthropic API key
python3 -m src.utils.db_init

# Daily run (does everything)
python3 run_mark.py

# Launch dashboard
PYTHONPATH=. streamlit run src/dashboard.py

# Generate weekly memo
python3 -m src.output.weekly_memo
```

## Lessons Learned

- **Security awareness is the real learning curve.** My main concern throughout was downloading things, running commands I don't fully understand, and sharing keys and passwords without certainty I'm not exposing things I shouldn't.
- **Judging quality takes time.** It will take real usage over weeks to know how well Mark is actually judging what matters vs what doesn't. The scoring framework is there, but calibrating it against my own strategic instincts requires accumulated data and repeated reading.
- **Memory is the value — and the risk.** The trend tracking across 7/30/90-day windows is what makes this more than a summarizer. But memory keeps growing, and I have concerns about database size limits and performance over months of use. Something to watch.
- **Prompting into a prompt works surprisingly well.** I was amazed how well I could describe what I wanted in plain language and have AI generate the actual detailed prompt that creates the agent. It didn't one-shot — errors came up along the way — but the troubleshooting was dramatically better than my experience months ago, where I'd get stuck in error loops and never finish. This time I actually shipped.
