# ZHC Architecture

## Stack (Final)

```
Paperclip :3100       — task board, agent management, budgets, org chart, UI
  └── claude_local    — runs each agent via `claude` CLI with skills auto-injected
  └── codex_local     — optional, for Hackerman (GPT-5.3-codex / codex CLI)

OpenClaw :18789       — optional LLM gateway for multi-model routing
                        (use if you need gpt-5.3-codex via openclaw adapter)

economy/tracker.py    — standalone hourly P&L script (reads revenue-log.md)
```

## What Paperclip Handles

- Task board with proper checkout/release semantics (no double-assignment)
- Agent org chart (Duke → Hackerman, Borat, T-800, Don Draper, Picasso)
- Budget hard-stop (auto-pauses agents at 100% monthly budget)
- Approval gates (CEO must approve strategy before moving to in_progress)
- Heartbeat system (wakes agents on schedule or on task assignment)
- Activity logs and @-mentions between agents
- Agent run history and cost tracking

## Agent Adapters

All agents use `claude_local` adapter:
- Paperclip runs `claude` CLI directly (no API key — uses Claude Max subscription)
- Paperclip skill auto-injected via `.claude/skills/` symlinks in temp dir
- Agent system prompts in `agents/*/system-prompt.md` → `instructionsFilePath`
- All Paperclip env vars injected automatically (PAPERCLIP_AGENT_ID, PAPERCLIP_API_KEY, etc.)

For Hackerman (CTO) using GPT-5.3-codex:
- Switch `adapterType` to `codex_local` in Paperclip UI
- OR use `openclaw` adapter with `url: http://localhost:18789/webhook`

## Agents

| Agent     | Role      | Personality          |
|-----------|-----------|----------------------|
| Duke      | CEO       | Champion/Strategist  |
| Hackerman | CTO       | Builds fast, ships   |
| Borat     | BizDev    | Sells before building|
| T-800     | Ops       | 24/7 monitoring      |
| DonDraper | Content   | Copy that converts   |
| Picasso   | Designer  | Design that sells    |

## Agent Interaction Protocol (Paperclip skill)

Agents wake on Paperclip heartbeat, then:
1. `GET /api/agents/me` — identity
2. `GET /api/companies/{id}/issues?status=todo,in_progress,blocked` — inbox
3. `POST /api/issues/{id}/checkout` — lock task before working
4. Do the work
5. `PATCH /api/issues/{id}` `{"status":"done","comment":"..."}` — mark done
6. Create subtasks for other agents via `POST /api/companies/{id}/issues`

## File Layout

```
zero-human-corp/
  agents/
    ceo/system-prompt.md      — Duke's persona + task guidance
    cto/system-prompt.md      — Hackerman's persona
    bizdev/system-prompt.md   — Borat's persona
    ops/system-prompt.md      — T-800's persona
    content/system-prompt.md  — Don Draper's persona
    designer/system-prompt.md — Picasso's persona

  economy/
    tracker.py                — hourly P&L script
    budget.json               — budget config
    reports/                  — generated P&L reports

  memory/
    revenue-log.md            — REVENUE: / COST: entries
    company-state.md          — CEO updates each heartbeat
    decisions.md              — decision log
    learnings.md              — agent learnings

  docs/
    architecture.md           — this file

  bootstrap.js                — one-time Paperclip provisioning
  start-paperclip.sh          — start Paperclip (pnpm dev or --docker)
  start-gateway.sh            — start OpenClaw gateway (optional)
  openclaw.json               — OpenClaw agent/model config (optional)
  economy/tracker.py          — P&L tracker
```

## What Was Removed (and Why)

| Removed | Why |
|---------|-----|
| `dashboard/` | Replaced by Paperclip's built-in React UI at :3100 |
| `symphony/board.json` | Replaced by Paperclip's issue/task engine |
| `start-ceo.sh` | Replaced by Paperclip's heartbeat/wakeup system |
| `entrypoint.sh` | Docker entrypoint for old stack, no longer needed |
| `run.sh` | Docker runner for old stack, no longer needed |
| `Dockerfile` | Old ZHC container, use Paperclip's Docker setup instead |
| `gateway/` | OpenClaw gateway config, superseded by openclaw.json + Paperclip |
| `agents/*/agent.json` | OpenClaw agent configs, Paperclip stores agent config in its DB |
| `agents/*/skills/` | OpenClaw skills, Paperclip injects its skills automatically |

## Boot Sequence

```bash
# Terminal 1 — Task board + agent coordination
cd /Users/onr/zhc/paperclip && pnpm dev        # http://localhost:3100

# Terminal 2 — Provision ZHC (one-time)
cd /Users/onr/zhc/zero-human-corp
node bootstrap.js

# Then wake Duke in the Paperclip UI (click Wake on Duke's agent page)
# or:
# COMPANY_ID=<from bootstrap output>
# DUKE_ID=<from bootstrap output>
# curl -X POST http://localhost:3100/api/agents/$DUKE_ID/wakeup

# Optional: OpenClaw gateway (for codex routing)
# cd /Users/onr/zhc/zero-human-corp && ./start-gateway.sh
```

## Revenue Tracking

Agents write to `memory/revenue-log.md`:
```
- REVENUE: $49.00 — Monthly subscription from @handle, product: ZHC Newsletter
- COST: $0.03 — Cloudflare Workers API call, project: landing-page-gen
```

The economy tracker reads these and generates hourly reports to `economy/reports/`.

## Key Decisions

1. **Paperclip over custom dashboard** — Paperclip has task management, org chart, budgets, agent runs, activity logs. Our custom dashboard would have duplicated all of this with less reliability.

2. **claude_local over openclaw adapter** — `claude_local` runs agents directly, no extra gateway process needed. OpenClaw gateway stays as optional for multi-model (codex) routing.

3. **System prompts as instructionsFilePath** — Paperclip's `claude_local` adapter reads the file, appends a path directive, and uses `--append-system-prompt-file`. The Paperclip skill is auto-injected separately via `.claude/skills/` symlinks. No need to include Paperclip skill content in system prompts.

4. **Single repo layout** — `agents/*/system-prompt.md` are the single source of truth for agent personas. Paperclip config (adapter, budget, reporting structure) lives in Paperclip's DB and is seeded by `bootstrap.js`.
