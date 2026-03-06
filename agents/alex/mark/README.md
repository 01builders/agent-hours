# Mark — Strategic News Synthesizer

Mark is an AI-powered intelligence agent that reads your TLDR newsletter emails (Founders, Fintech, Crypto), extracts what matters, tracks trends over time, and delivers concise strategic briefings for a Chief Strategy Officer working in crypto / Web3.

## What Mark Does

1. **Reads your newsletters** — Connects to a dedicated email inbox via IMAP and ingests TLDR Founders, TLDR Fintech, and TLDR Crypto editions.
2. **Extracts and enriches links** — Fetches articles linked inside those newsletters and summarizes them.
3. **Categorizes everything** — Tags content into strategy-relevant themes (stablecoins, payments, compliance, M&A, developer tooling, etc.).
4. **Ranks by strategic importance** — Separates hype from substance using a transparent scoring framework.
5. **Remembers trends** — Tracks what's rising, fading, recurring, or unresolved across 7 / 30 / 90 days.
6. **Generates a daily briefing** — A 1-2 minute executive read: what matters, what changed, what to watch.
7. **Generates a weekly memo** — Deeper synthesis with roadmap, positioning, M&A, and messaging implications.
8. **Shows a dashboard** — A Streamlit app with trend charts, filters, standout items, and recommendations.
9. **Recommends strategy** — Product opportunities, roadmap suggestions, acquisition signals, positioning angles.

**Mark only reads TLDR newsletters and links inside them. No other sources.**

---

## Setup Instructions (Mac)

### Step 1: Install Python

Open **Terminal** (press `Cmd + Space`, type "Terminal", press Enter).

Check if Python is installed:
```bash
python3 --version
```

If you see `Python 3.11` or higher, skip ahead. Otherwise, install it:

```bash
# Install Homebrew (Mac package manager) if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Python
brew install python@3.11
```

### Step 2: Create a Dedicated Email Inbox

Create a **new Gmail account** (or use any IMAP-capable email) specifically for Mark.

1. Go to https://mail.google.com and create a new account (e.g., `mark.reader.agent@gmail.com`).
2. Subscribe that email to:
   - **TLDR Founders**: https://tldr.tech/founders
   - **TLDR Fintech**: https://tldr.tech/fintech
   - **TLDR Crypto**: https://tldr.tech/crypto
3. Enable IMAP access:
   - Gmail → Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP → Save
4. Create an **App Password** (required if 2FA is on):
   - Go to https://myaccount.google.com/apppasswords
   - Generate one for "Mail" and save it somewhere safe

### Step 3: Get an Anthropic API Key

1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Go to API Keys → Create Key
4. Copy the key (starts with `sk-ant-...`)

### Step 4: Download or Clone the Project

If you have the project as a zip file, unzip it. Otherwise:

```bash
cd ~/Desktop
git clone https://github.com/YOUR_USERNAME/mark.git
cd mark
```

Or if you're creating it from scratch:
```bash
mkdir -p ~/Desktop/mark
cd ~/Desktop/mark
# Copy all project files here
```

### Step 5: Create a Virtual Environment

```bash
cd ~/Desktop/mark
python3 -m venv venv
source venv/bin/activate
```

You should see `(venv)` at the beginning of your terminal line. **Always activate this before running Mark.**

### Step 6: Install Dependencies

```bash
pip install -r requirements.txt
```

### Step 7: Configure Environment Variables

```bash
cp .env.example .env
```

Now open `.env` in a text editor:
```bash
open -e .env
```

Fill in your values:
- `IMAP_SERVER=imap.gmail.com`
- `IMAP_PORT=993`
- `IMAP_EMAIL=mark.reader.agent@gmail.com`
- `IMAP_PASSWORD=your-app-password-here`
- `ANTHROPIC_API_KEY=sk-ant-your-key-here`

Save and close.

### Step 8: Initialize the Database

```bash
python3 -m src.utils.db_init
```

### Step 9: Run Your First Ingestion

```bash
python3 -m src.ingestion.ingest
```

This connects to the email inbox, downloads TLDR newsletters, parses them, and stores them in the database. First run may take a few minutes depending on how many emails are in the inbox.

### Step 10: Enrich Links

```bash
python3 -m src.ingestion.enrich_links
```

This fetches and summarizes articles linked in the newsletters. Can take a while on first run.

### Step 11: Run Analysis (Categorize + Score + Trends)

```bash
python3 -m src.analysis.run_analysis
```

### Step 12: Generate Daily Briefing

```bash
python3 -m src.output.daily_briefing
```

The briefing is saved to `data/briefings/` and printed to terminal.

### Step 13: Generate Weekly Memo

```bash
python3 -m src.output.weekly_memo
```

### Step 14: Launch Dashboard

```bash
streamlit run src/dashboard.py
```

Open your browser to `http://localhost:8501`.

### Step 15: Run Everything at Once

```bash
python3 run_mark.py
```

This runs ingestion → enrichment → analysis → daily briefing in sequence.

---

## Scheduling Daily Runs (Mac)

To run Mark every morning automatically:

```bash
crontab -e
```

Add this line (runs at 8am daily):
```
0 8 * * * cd /Users/YOUR_USERNAME/Desktop/mark && /Users/YOUR_USERNAME/Desktop/mark/venv/bin/python run_mark.py >> logs/cron.log 2>&1
```

Replace `YOUR_USERNAME` with your Mac username. Find it by running `whoami` in Terminal.

---

## Pushing to GitHub

```bash
cd ~/Desktop/mark
git init
git add .
git commit -m "Initial commit: Mark strategic synthesizer"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/mark.git
git push -u origin main
```

---

## Project Structure

```
mark/
├── README.md               ← You are here
├── .env.example            ← Template for secrets
├── .gitignore              ← Keeps secrets out of GitHub
├── requirements.txt        ← Python dependencies
├── run_mark.py             ← One-command daily runner
├── src/
│   ├── __init__.py
│   ├── config.py           ← Loads .env settings
│   ├── dashboard.py        ← Streamlit app
│   ├── ingestion/
│   │   ├── __init__.py
│   │   ├── ingest.py       ← IMAP email reader
│   │   ├── parser.py       ← Newsletter parser
│   │   └── enrich_links.py ← Link fetcher/summarizer
│   ├── analysis/
│   │   ├── __init__.py
│   │   ├── categorizer.py  ← Theme tagging
│   │   ├── scorer.py       ← Strategic importance scoring
│   │   ├── memory.py       ← Trend tracking / memory
│   │   └── run_analysis.py ← Orchestrates analysis pipeline
│   ├── output/
│   │   ├── __init__.py
│   │   ├── daily_briefing.py  ← Daily executive briefing
│   │   └── weekly_memo.py     ← Weekly strategic memo
│   └── utils/
│       ├── __init__.py
│       ├── db_init.py      ← Database setup
│       ├── models.py       ← SQLAlchemy models
│       ├── llm.py          ← Anthropic API wrapper
│       ├── logger.py       ← Logging config
│       └── helpers.py       ← Shared utilities
├── prompts/
│   ├── categorize.txt
│   ├── score.txt
│   ├── daily_briefing.txt
│   ├── weekly_memo.txt
│   ├── summarize_link.txt
│   └── recommendations.txt
├── tests/
│   ├── __init__.py
│   ├── test_parser.py
│   ├── test_scorer.py
│   └── test_models.py
├── data/
│   ├── mark.db             ← SQLite database (created on first run)
│   └── briefings/          ← Saved briefings
└── logs/
    └── mark.log            ← Application logs
```

---

## Common Errors and Fixes

| Problem | Fix |
|---------|-----|
| `ModuleNotFoundError` | Make sure your virtual environment is activated: `source venv/bin/activate` |
| `IMAP login failed` | Check your email/password in `.env`. For Gmail, use an App Password, not your regular password. |
| `ANTHROPIC_API_KEY not set` | Make sure `.env` exists and has your key. Run `cat .env` to check. |
| `Database not found` | Run `python3 -m src.utils.db_init` |
| `Connection refused` on dashboard | Make sure you ran `streamlit run src/dashboard.py`, not `python3 src/dashboard.py` |
| `Rate limit` from Anthropic | Mark processes items with delays built in. If you hit limits, wait a few minutes and re-run. |

---

## Future Improvements

- Slack integration for briefing delivery
- Export briefings to PDF or email
- Custom theme watchlists
- Alert system for high-importance signals
- Support for additional newsletter sources
- Multi-user role views
- Historical backfill tooling
