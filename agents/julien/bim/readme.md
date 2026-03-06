# BiM

BiM is an AI-powered smart contract security agent for EVM blockchain. It continuously discovers newly verified contracts via [Sourcify](https://docs.sourcify.dev/docs/intro), runs deep security analysis on their source code using a choosen model, and produces bug bounty reports complete with Foundry proof-of-concept exploits — all from a terminal UI you can chat with.

Built with the [Google ADK for Go](https://google.github.io/adk-docs/get-started/go/) and wrapped in a [Bubbletea v2](https://charm.land/bubbletea) TUI.

## How it works

```
┌───────────────────────────────────────────────────────────┐
│  Sourcify API                                             │
│  (recently verified contracts)                            │
└────────────────┬──────────────────────────────────────────┘
                 │ poll every N seconds
                 ▼
┌───────────────────────────────────────────────────────────┐
│  Discovery                                                │
│  Store new contracts in SQLite with status "pending"      │
└────────────────┬──────────────────────────────────────────┘
                 │
                 ▼
┌───────────────────────────────────────────────────────────┐
│  Analyzer (LLM AI)                                        │
│  Single-pass or two-pass strategy depending on size       │
│  Augmented with embedded analysis skills                  │
│  Outputs findings ranked by severity                      │
└────────────────┬──────────────────────────────────────────┘
                 │ Critical / High findings
                 ▼
┌───────────────────────────────────────────────────────────┐
│  Reporter (LLM AI)                                        │
│  Generates Markdown bug bounty report + Foundry PoC       │
│  Saves reports to data/ directory                         │
└───────────────────────────────────────────────────────────┘
```

The entire pipeline is exposed as a set of **ADK tools** that the LLM agent can call autonomously or on your command through the chat interface.

## TUI

BiM runs as a full-screen terminal application with two tabs:

```
┌─────────────────────────────────────────────┐
│ [Chat]  [Logs]            ⏳ Analyzing …    │  ← tab bar
├─────────────────────────────────────────────┤
│                                             │
│   You: analyze 0xABC…                       │
│   ⚙ Calling Analyzing contract             │
│   ✔ Analyzing contract complete            │
│   BiM: Found 3 findings (1 Critical) …      │  ← scrollable viewport
│                                             │
├─────────────────────────────────────────────┤
│ > _                                         │  ← text input
└─────────────────────────────────────────────┘
```

| Key             | Action                       |
| --------------- | ---------------------------- |
| `Tab`           | Switch between Chat and Logs |
| `Enter`         | Submit prompt                |
| `↑` / `↓`       | Scroll viewport              |
| `PgUp` / `PgDn` | Scroll viewport (page)       |
| `Ctrl+C`        | Quit                         |

The **Chat** tab is your conversation with the agent. Tool invocations are shown in real time as they happen (e.g. `⚙ Calling Discovering contracts`), and streaming model output renders live.

The **Logs** tab captures all `slog` output from every subsystem — discovery polling, Sourcify HTTP calls, analyzer passes, report generation — with colour-coded severity (yellow for WARN, red for ERROR).

## Agent tools

These are the tools the LLM agent has access to. You can ask for them by name or describe what you want in natural language.

| Tool                 | Description                                                       |
| -------------------- | ----------------------------------------------------------------- |
| `discover_contracts` | Trigger an immediate discovery cycle across configured chains     |
| `analyze_contract`   | Run security analysis on a specific contract (chain ID + address) |
| `generate_report`    | Generate a bug bounty report for a finding                        |
| `run_pipeline`       | Run the full discover → analyze → report pipeline                 |
| `generate_poc`       | Generate only the Foundry PoC exploit for a finding               |
| `reanalyze_contract` | Force re-analysis of a previously analyzed contract               |
| `discovery_status`   | Check background discovery loop status and results                |

A background discovery loop polls Sourcify automatically at the configured interval. You do not need to trigger discovery manually for routine monitoring.

## Setup

### Prerequisites

- **Go 1.26+**
- A **Google Cloud API key** ([get one here](https://aistudio.google.com/app/apikey))

### Install and run

```sh
git clone https://github.com/julien-robert-music/bim.git  # or your fork
cd bim
cp config.example.yaml config.yaml
```

Edit `config.yaml` and set your `google_api_key`, then:

```sh
go run .
```

Or build and run:

```sh
go build -o bim .
./bim
```

## Configuration

BiM is configured via a YAML file (default: `config.yaml`, override with `BIM_CONFIG` env var).

```yaml
# Required — Google Cloud API key.
google_api_key: "YOUR_KEY"

# Model to use (default: gemini-2.5-pro).
model_name: gemini-2.5-pro

# Logging verbosity: debug, info, warn, error.
log_level: info

# Directory for reports and persistent data.
data_dir: ./data

# SQLite database path.
db_path: ./data/bim.db

# Sourcify API base URL.
sourcify_base_url: https://sourcify.dev/server

# Background discovery poll interval.
poll_interval: 60s

# Chains to monitor.
chains:
  - id: 1
    name: Ethereum Mainnet
    rpc_url: https://eth.llamarpc.com
  - id: 8453
    name: Base
    rpc_url: https://mainnet.base.org
```

All settings have sensible defaults except `google_api_key`.

## Analysis skills

The analyzer is augmented with a set of embedded **skills** — domain-specific knowledge files that are injected into the system prompt based on the contract being analyzed. Current skills include:

- **Entry-point analyzer** — identifies external/public attack surface
- **Token integration analyzer** — detects ERC-20/721 integration pitfalls
- **Variant analysis** — finds known vulnerability patterns and their variants
- **False-positive patterns** — reduces noise by filtering common non-issues
- **Audit prep & guidelines** — structures output for bug bounty submission

Skills are embedded at compile time from `internal/analyzer/skills/*.md` and selected dynamically per contract.

## License

[MIT](license) — Copyright (c) 2026 Julien Robert and contributors.
