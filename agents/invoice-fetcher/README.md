# Agent Submission

## Author

Onur Akpolat

## Agent Name

Invoice Fetcher

## One-Line Description

An AI agent that automates downloading invoices from SaaS billing portals and uploading them to Google Drive.

## What job does this agent own?

Logging into 8+ SaaS billing portals (Anthropic, OpenAI, Vercel, Railway, Cursor, Midjourney, etc.), finding all invoices, downloading PDFs, renaming them with a consistent naming convention (`YYYY-MM-DD_service_invoice-id.pdf`), and optionally uploading to Google Drive. This replaces 30+ minutes of manual portal-hopping every month.

## Why should this be an agent?

This workflow requires multi-step reasoning and tool use at every stage:
- **Login detection**: The agent must determine if a session is still valid or if the user needs to re-authenticate manually.
- **Navigation decisions**: Every billing portal has a different UI structure. The agent uses natural language hints to navigate via browser automation, adapting to UI changes.
- **Deduplication logic**: The agent reads a manifest of previously downloaded invoices and decides which are new vs. already fetched.
- **Error recovery**: If a service fails (timeout, login expired, UI changed), the agent logs the error and moves to the next service rather than crashing.
- **Multi-service orchestration**: Processing 8 services sequentially, carrying state (manifest) across them, and producing a unified summary.

A deterministic script would break every time a portal changes its UI. The agent handles this through Stagehand's AI-driven browser interaction.

## What tools does the agent use?

| Tool | Purpose |
|------|---------|
| **Stagehand** (`@browserbasehq/stagehand`) | Browser automation via natural language - navigates billing pages, extracts invoice data, triggers downloads |
| **gws** (`@googleworkspace/cli`) | Google Drive uploads via CLI |
| **Node.js fs** | Local file operations - download polling, manifest read/write |
| **Chrome** (via chrome-launcher) | Persistent browser sessions with saved login cookies |

The agent registers 7 custom MCP tools:
- `check_login` - Verify if a session is active
- `browse_billing` - Navigate to the invoices section
- `list_invoices` - Extract structured invoice data from the page
- `download_invoice` - Trigger download and rename with consistent naming
- `upload_to_drive` - Upload to Google Drive folder
- `read_manifest` / `save_manifest` - Track what's already been downloaded

## What framework or stack did you use?

- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) - Orchestration layer. Claude reasons about the workflow, calls tools, handles errors, and produces summaries.
- **Stagehand v3** (`@browserbasehq/stagehand`) - Browser automation layer. Uses its own internal LLM to interpret natural language instructions and interact with web UIs.
- **TypeScript + tsx** - Runtime
- **Zod** - Schema validation for tool inputs and extracted data

Two-LLM architecture: Claude (via Agent SDK) orchestrates the high-level workflow; Stagehand's internal LLM handles low-level browser interaction. Cleanly separated - Claude never drives the browser directly.

## What are the boundaries?

- **What can it do automatically?**
  - Navigate to billing pages, extract invoice lists, download PDFs, rename files, upload to Drive, track state in a manifest
- **What requires human approval?**
  - Initial login to each service (user logs in once via `--login` mode, cookies persist in Chrome profile)
  - Setting up Google Drive auth (`gws auth login`)
- **What should make it stop or escalate?**
  - Login expired (reports and skips the service)
  - Download fails after one retry (logs error, moves to next service)
  - Never retries more than once per service

## How do you evaluate it?

- **Dry-run mode** (`--dry-run`): Lists all invoices found without downloading - verifies login status, navigation, and extraction work correctly
- **Manifest correctness**: Second run should skip already-downloaded invoices
- **File naming**: Downloaded files follow `YYYY-MM-DD_service-key_invoice-id.pdf` convention
- **Service coverage**: Agent reports a summary table showing services processed, invoices found, downloaded, uploaded, and errors

## What level is this agent?

**Level 2 - Agent with knowledge and storage**

- Has instructions (system prompt defining the invoice-fetching workflow)
- Has tools (7 custom MCP tools for browser, download, drive, manifest)
- Has knowledge (YAML config with service definitions and natural language hints)
- Has storage (JSON manifest tracking downloaded invoices across runs)
- Single agent (not multi-agent), but with persistent state

## Demo / How to Run

### Prerequisites

- Node.js 22+
- Chrome installed locally
- `ANTHROPIC_API_KEY` environment variable
- (Optional) `gws` CLI for Google Drive uploads

### Setup

```bash
cd agents/invoice-fetcher
npm install

# Create .env with your API key
echo "ANTHROPIC_API_KEY=your-key-here" > .env
chmod 600 .env
```

### Step 1: Log in to services

```bash
# Opens a Chrome window - log into services manually
npx tsx src/index.ts --login --services anthropic-api

# Or log into all services at once
npx tsx src/index.ts --login
```

Sessions persist in the Chrome profile (`data/chrome-profile/`).

### Step 2: Dry run

```bash
# See what invoices are found without downloading
npx tsx src/index.ts --dry-run --services anthropic-api
```

### Step 3: Download invoices

```bash
# Download from one service
npx tsx src/index.ts --services anthropic-api

# Download from all configured services
npx tsx src/index.ts

# Download + upload to Google Drive
npx tsx src/index.ts --upload
```

### CLI Options

```
--full-sync        Download ALL invoices, not just new ones
--services <list>  Comma-separated service keys (default: all)
--upload           Upload to Google Drive after download
--headless         Run browser headless (only if already logged in)
--dry-run          List invoices without downloading
--config <path>    Config file path (default: ./config.yaml)
--login            Open browser for manual login
```

### Adding a new service

Edit `config.yaml` - no code changes needed:

```yaml
services:
  newservice:
    name: New Service
    billingUrl: https://newservice.com/billing
    loginCheck: "sign in"
    hints:
      navigate: "click on billing history"
      extract: "extract all invoice rows with date, amount, and ID"
      download: "click download for invoice {id}"
```

### Google Drive setup (optional)

```bash
npm install -g @googleworkspace/cli
gws auth login
# Set driveFolderId in config.yaml to your folder ID
```

## Lessons Learned

- **Two-LLM architecture works well**: Claude Agent SDK for orchestration + Stagehand for browser interaction is a clean separation. Claude never needs to know about CSS selectors or DOM structure.
- **YAML hints are surprisingly effective**: Generic natural language instructions like "click on billing history" work across completely different UIs thanks to Stagehand's AI-driven approach. Adding a new service is config-only.
- **Login persistence is the hardest part**: The actual invoice extraction was straightforward. Getting Chrome sessions to persist reliably across runs (via `userDataDir`) and detecting when sessions expire required the most iteration.
- **Invoice IDs are inconsistent**: Some portals (Anthropic) show generic labels like "Monthly invoice" instead of unique IDs. The extract hints need to be specific about constructing unique identifiers from available data (type + amount + date).
- **Agent SDK nesting quirk**: The Claude Agent SDK spawns a `claude` subprocess. If you're already in a Claude Code session, you need to `delete process.env.CLAUDECODE` to avoid the nesting guard.
- **Cost awareness**: Two LLM layers (Claude for orchestration, Stagehand's model for browser) means double the API calls. Using `anthropic/claude-sonnet-4-5` for Stagehand keeps browser automation costs reasonable while Claude Opus handles the orchestration.
