# PRPilot

PRPilot is a Telegram webhook service that runs Pi tasks on selected local repositories and can open pull requests to `main`.

It is designed for a single authorized Telegram user, multi-repo selection, and repeatable task boundaries (always reset to clean `main` before and after runs).

## What it does

- Receives Telegram updates via webhook
- Supports repository selection per chat (`/repo <name>`)
- Supports **planning** runs (free-text) in read-only mode — the agent can inspect files but cannot modify the repository
- Supports task selection (`/select <n>`) to continue planning or apply a task
- Supports **apply** runs (`/apply`) that:
  - create a feature branch
  - run the agent in read-write mode
  - commit changes
  - push branch
  - open a PR to `main`
- Formats all Telegram responses as HTML (Markdown from the agent is converted automatically)
- Uses GitHub App auth (JWT + installation token flow)
- Exposes health + Prometheus metrics endpoints

## Quick start (local)

```bash
npm install
cp .env.example .env
# edit .env
npm run dev
```

Service defaults:
- Main app: `http://localhost:8080`
- Metrics app: `http://localhost:9090/metrics`

## Telegram setup

### 1) Create bot token

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Run `/newbot`
3. Save returned token as `TELEGRAM_BOT_TOKEN`

### 2) Generate webhook secret

```bash
openssl rand -hex 32
```

Set output as `TELEGRAM_WEBHOOK_SECRET`.

PRPilot validates both:
- webhook URL token segment
- `X-Telegram-Bot-Api-Secret-Token` header

## Configuration

### Required environment variables

| Variable | Example | Notes |
|---|---|---|
| `PUBLIC_BASE_URL` | `https://prpilot.example.com` | Used to register Telegram webhook |
| `TELEGRAM_BOT_TOKEN` | `123456:AA...` | Bot token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | random hex | Webhook path + header validation |
| `TELEGRAM_ALLOWED_USER_ID` | `123456789` | Only this Telegram user is allowed |
| `REPO_OWNER` | `auricom` | GitHub owner/org for PR creation |
| `REPOS_ROOT` | `/workspace` | Repos are resolved as `<REPOS_ROOT>/<repo-name>` |
| `REPO_NAMES` | `repo-one,repo-two` | Allowed repos for `/repo` |
| `REPO_BASE_BRANCH` | `main` | Must be `main` |
| `GITHUB_APP_ID` | `123456` | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY_PATH` or `GITHUB_APP_PRIVATE_KEY_PEM` | path or PEM | One is required |

### Optional environment variables

| Variable | Default | Notes |
|---|---|---|
| `GITHUB_APP_INSTALLATION_ID` | auto-discover | Optional explicit installation ID |
| `SESSION_DIR` | `/data/sessions` | Stores selected repos, task history, intents |
| `PORT` | `8080` | Main app port |
| `METRICS_PORT` | `9090` | Metrics app port |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `NODE_ENV` | unset | Use `development` for dev behavior |

## Telegram command guide

| Command | Description |
|---------|-------------|
| `/repo` | Show current repo and supported repos |
| `/repo <name>` | Select repo for this chat |
| `/status` | Show health, selected repo, branch, active task |
| `/tasks` | Show recent task list |
| `/task <n>` | Show detailed task entry |
| `/select <n>` | Select a planning task to continue or apply |
| `/select 0` | Deselect the active task |
| `/select` | Show which task is currently active |
| `/new` | Clear active task and start fresh |
| `/delete <n>` | Delete a task from history |
| `/apply` | Apply the active task (or infer from chat context) |
| `/apply <task>` | Apply an explicit task directly |
| `/abort` | Abort the current run |
| free-text | Start or continue a planning run |

### Task lifecycle

Tasks have two primary statuses: **planning** and **applied**.

1. Send a free-text message → creates a new task in `planning` status
2. Use `/select <n>` to pick an existing planning task → subsequent messages continue that task
3. Use `/apply` → the selected (or inferred) task transitions to `applied` once the PR is created
4. Task selection clears after apply completes

Additional terminal statuses: `failed`, `no-changes`, `aborted`.

Task history is capped at 10 entries — older tasks are automatically dropped on save.

## Execution flow

### Planning run (free-text)

1. Require selected repo (`/repo <name>`)
2. Reset repo to clean `origin/main`
3. Run Pi in **read-only** `chat` mode (agent has `read`, `grep`, `find`, `ls`, and `web` tools — `web` runs lynx for internet access)
4. Create or update task entry in history (if a task is selected via `/select`, the same entry is updated)
5. Derive a concise task title from the agent response
6. Reset repo to clean `origin/main`

### Apply run (`/apply`)

1. Require selected repo
2. Reset repo to clean `origin/main`
3. Resolve task prompt:
   - From selected task (via `/select`) if active
   - From explicit argument (`/apply <task>`)
   - Inferred from last chat summary
4. Create feature branch
5. Run Pi in **read-write** `apply` mode (full coding tools)
6. Commit and push changes
7. Open PR to `main`
8. Task transitions to `applied`; selection clears
9. Reset repo to clean `origin/main`

## PR body templates

PRPilot can render PR bodies from user-imported templates, loaded on every `/apply` run (no restart required).

A bundled starter template is included in this repository at `pr-body-template.md`.

Resolution order:
1. Repo override: `<repoPath>/.prpilot/pr-body-template.md`
2. Global fallback: `<SESSION_DIR>/pr-body-template.md`
3. Built-in default template

Supported placeholders:
- `{{task}}`
- `{{agent_summary}}`
- `{{commit_summary}}`
- `{{branch}}`
- `{{base_branch}}`
- `{{repo_name}}`
- `{{repo_owner}}`

If template loading or rendering fails, PRPilot logs a warning and falls back to the built-in default body so PR creation can continue.

## Observability

### Health endpoints

- Main app:
  - `GET /healthz`
  - `GET /readyz`
- Metrics app:
  - `GET /healthz`
  - `GET /readyz`
  - `GET /metrics`

### Logging

- Structured key/value logs to stderr
- No app-side timestamps (runtime/Kubernetes provides timestamps)
- Request correlation via `requestId`
- Set `LOG_LEVEL=DEBUG` for detailed execution traces

### Prometheus metrics

`/metrics` is served on the separate metrics server (`METRICS_PORT`).

Main app HTTP metrics:
- `http_requests_total{method,route,status_code}`
- `http_request_duration_seconds{method,route,status_code}`

Route labels are templated (for example: `/telegram/webhook/:token`) to avoid high cardinality and secret leakage.

Pi agent behavior metrics:
- `pi_runs_total{mode,result}` (`result`: `success|error|busy|empty-output|aborted`)
- `pi_run_duration_seconds{mode,result}`
- `pi_session_get_total{mode,cache}` (`cache`: `hit|miss`)
- `pi_session_abort_total{result}` (`result`: `aborted|no-active`)
- `pi_sessions_active`
- `pi_session_index_io_errors_total{op}` (`op`: `read|write`)
- `pi_agents_md_load_failures_total`

### Suggested alerts (when you add alerting)

A ready-to-use rule file is included at `alerts/pi-agent-rules.yaml`.

- **High Pi run failure ratio**
  - `sum(rate(pi_runs_total{result=~"error|aborted|empty-output"}[10m])) / sum(rate(pi_runs_total[10m])) > 0.2`
- **Busy contention spike**
  - `rate(pi_runs_total{result="busy"}[5m]) > 0`
- **Slow Pi runs (p95)**
  - `histogram_quantile(0.95, sum by (le,mode) (rate(pi_run_duration_seconds_bucket[10m]))) > 60`
- **Session index IO errors**
  - `increase(pi_session_index_io_errors_total[15m]) > 0`
- **AGENTS.md load failures**
  - `increase(pi_agents_md_load_failures_total[15m]) > 0`

## Build, test, checks

```bash
npm run build
npm test
npm run check:logging
npm run check
```

## Deployment notes

- Expose main app (`PORT`) publicly for Telegram webhook delivery
- Keep metrics app (`METRICS_PORT`) internal/private for Prometheus scraping
- Never commit bot token, webhook secret, or GitHub private key
- Ensure each repo in `REPO_NAMES` exists at `<REPOS_ROOT>/<name>` and contains `AGENTS.md`

## Target repository best practices

If a repository should be safely operated by PRPilot, organize it with these conventions:

- **Required root files**
  - `AGENTS.md` at repository root (mandatory; PRPilot fails runs if missing)
  - clear `README.md` for project context
  - standard ignore rules (`.gitignore`) and local env template (`.env.example`) if env vars are needed
- **Git layout**
  - remote `origin` configured and reachable
  - default/base branch is `main` (PRPilot resets to and opens PRs against `main`)
  - avoid long-lived uncommitted local changes in target repos
- **Automation entrypoints**
  - stable build/test commands (for example `npm test`, `npm run build`) so agent tasks can verify changes
  - CI should validate PRs created by PRPilot feature branches
- **Agent friendliness**
  - keep task-relevant docs close to code (`docs/`, architecture notes, runbooks)
  - avoid ambiguous repository layouts; prefer predictable paths and naming
  - keep secrets out of tracked files and out of prompts
- **Scope control**
  - only include repos in `REPO_NAMES` that you explicitly allow PRPilot to modify
  - if a repo is read-only for experimentation, keep it out of `REPO_NAMES`

## Troubleshooting

- **Unauthorized in Telegram**: verify `TELEGRAM_ALLOWED_USER_ID`
- **Webhook not receiving updates**: verify `PUBLIC_BASE_URL` and webhook secret
- **Repo selection fails**: check repo exists and is a valid git worktree
- **Apply fails to open PR**: verify GitHub App permissions/installation and `REPO_OWNER`
- **No metrics**: check metrics server port and scrape `http://<host>:<METRICS_PORT>/metrics`
