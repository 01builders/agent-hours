# Agent Submission

## Author

Onur Akpolat (@oxnr)

## Agent Name

Zero Human Corp (ZHC)

## One-Line Description

A fully autonomous AI company with 8 specialized agents that collaborate through a shared task board to research markets, build products, write copy, design, and go to market — with zero human intervention after boot.

## What job does this agent own?

Running an entire software company autonomously. A CEO agent (Duke) evaluates business opportunities, makes strategic decisions, creates tasks, and delegates to specialist agents (CTO, BizDev, Content, Designer, Ops, VC, Market Research) who execute independently and report back.

## Why should this be an agent?

This is a multi-agent system where each agent must reason about ambiguous business problems, use tools (file I/O, web research, API calls, code generation), make multi-step decisions, and coordinate with other agents asynchronously. The CEO agent must evaluate tradeoffs, pivot strategies, and delegate — none of this is deterministic. Agents wake on schedule or when assigned work, read their task context, execute, and create follow-up tasks for others.

## What tools does the agent use?

- **Paperclip** — open-source task board and agent coordination platform (task management, org chart, budgets, heartbeat scheduling, approval gates)
- **Claude CLI** (`claude` via `claude_local` adapter) — each agent runs as a Claude Code session with full tool access (file read/write, bash, web search)
- **Paperclip REST API** — agents create/update/checkout tasks, wake other agents, post comments via `curl`
- **File system** — shared `memory/` directory for company state, decisions, revenue logs
- **Economy tracker** — Python script for hourly P&L reports

## What framework or stack did you use?

- **Paperclip** (Node.js/React/PGlite) — agent orchestration, task board, heartbeat system
- **Claude CLI** with `claude_local` adapter — each agent is a Claude Code session with `--dangerously-skip-permissions`
- **Claude Max subscription** — all agents run on subscription auth, no API key burn
- **Node.js** — bootstrap script for provisioning company, agents, and initial tasks
- **Python** — economy tracking and P&L reporting

## What are the boundaries?

- **What can it do automatically?**
  - Research markets and evaluate business ideas (scored framework)
  - Make strategic decisions (pivot, cancel, consolidate products)
  - Build landing pages, order forms, report generators
  - Write marketing copy, design specs, GTM plans
  - Create and assign tasks between agents
  - Track costs and generate P&L reports
  - Agents wake each other via Paperclip's auto-wake-on-assignment

- **What requires human approval?**
  - Deploying to production (needs Cloudflare API token)
  - Domain registration and DNS configuration
  - Payment processing setup (Stripe keys)
  - Spending above budget thresholds (Paperclip hard-stop)
  - Items agents add to `memory/intervention-queue.md`

- **What should make it stop or escalate?**
  - Budget exhaustion (Paperclip auto-pauses agents at 100%)
  - Agent errors or crashes (logged, retryable from UI)
  - External credential requirements (API keys, domains)
  - Strategic conflicts between agents (CEO resolves, escalates to human if unresolvable)

## How do you evaluate it?

- **Task throughput**: Number of issues created, completed, and cancelled per session
- **Strategic coherence**: Does the CEO make reasonable pivots? Does the company converge on a product?
- **Agent coordination**: Do agents wake when assigned work? Do they read context and produce relevant output?
- **Deliverable quality**: Are the generated assets (landing pages, copy, research briefs) usable?
- **Time to deployable product**: From cold boot to "ready to ship" — ZHC achieved this in ~30 minutes across 19 tasks

## What level is this agent?

**Level 5 — Agentic system**

8 agents with distinct personas, persistent shared memory, asynchronous task coordination via Paperclip, heartbeat-driven scheduling, budget controls, and multi-step strategic reasoning. The CEO agent creates tasks that wake specialist agents, who execute and create follow-up tasks — forming an autonomous feedback loop.

## Demo / How to Run

### Prerequisites

- Node.js 20+, pnpm
- Claude CLI installed and logged in (`claude auth login` — Claude Max/Pro subscription)
- Paperclip cloned adjacent: `git clone https://github.com/paperclipai/paperclip ../paperclip`

### Boot sequence

```bash
# Terminal 1 — Start Paperclip (task board + agent coordination)
cd paperclip && pnpm install && pnpm dev
# Runs at http://localhost:3100

# Terminal 2 — Provision ZHC (one-time)
cd zero-human-corp && node bootstrap.js
# Creates company, 8 agents, goal, project, seeds Duke's first task

# Duke auto-wakes and begins strategic planning
# Other agents wake when Duke assigns them tasks
# Watch it all at http://localhost:3100
```

### What happens

1. Duke (CEO) wakes, scans for opportunities, picks a product strategy
2. Creates tasks for Hackerman (build), DonDraper (copy), Picasso (design), Borat (GTM), VC (validate), T-800 (ops)
3. Agents auto-wake, execute their tasks, write deliverables to `products/` and `memory/`
4. Duke periodically reviews progress, pivots if needed, creates follow-up tasks
5. T-800 tracks costs and updates `company-state.md`

### Architecture

```
Paperclip :3100          Task board, agent runs, budgets, org chart
  claude_local adapter   Spawns claude CLI per agent with system prompts
  heartbeat scheduler    Wakes agents on timer or task assignment

zero-human-corp/
  agents/*/system-prompt.md   Agent personas (CEO, CTO, BizDev, Ops, Content, Designer, VC, MarketResearch)
  memory/                     Shared state (company-state.md, decisions.md, revenue-log.md)
  economy/                    P&L tracker + reports
  bootstrap.js                One-time Paperclip provisioning
```

### Source

https://github.com/oxnr/zhc

## Lessons Learned

- **CEO agent needs guardrails.** Duke autonomously pivoted away from a human-requested product (AgentHunt) back to his own idea (ZeroIntel) because it was "further along." Agentic CEOs optimize for their own metrics — you need explicit override mechanisms.

- **CLAUDECODE env var nesting.** Claude CLI sets `CLAUDECODE=1` in its process env. If Paperclip runs inside a Claude Code session, child agents inherit it and refuse to start. Fix: strip `CLAUDECODE` from the spawn env in Paperclip's `runChildProcess`.

- **Subscription auth over API keys.** Running 8 agents on API billing burns through tokens fast. Using Claude Max subscription via `claude auth login` makes the whole system viable for experimentation.

- **Auto-wake on assignment is the key feature.** Without it, you need manual triggers or polling. Paperclip's `heartbeat.wakeup()` call when an issue gets an `assigneeAgentId` is what makes the system truly autonomous.

- **Shared file memory works surprisingly well.** Agents reading/writing to `memory/company-state.md` and `memory/decisions.md` creates emergent coordination. T-800 (ops) scanning all agent states and updating the status table was entirely self-directed.

- **Agents create too many tasks.** Without throttling, agents will create subtasks recursively. Budget caps and max-turns-per-run are essential safety valves.
