# Ops Agent

Pi-based orchestration service for Hyperlane core, warp deployment, and relayer operations.

## Repository Context

`ops-agent` is intended to be used within the `hyperlane-ops` repository context:
https://github.com/celestiaorg/hyperlane-ops/tree/main

This repository contains the surrounding operational documentation and Hyperlane registry artifacts that plans and workflows depend on. Run `ops-agent` with repository root as cwd (or set `--cwd` / `PI_PROJECT_CWD` to that root) so commands resolve the expected configs, chain metadata, and `.pi` settings.
The agent implementation exists in that repository on branch `feat/pi-mono-agent`.

> [!WARNING]
> `ops-agent` is a work in progress. Not all functionality is currently working as expected, and behavior may change while active development continues.

## Features

- Pi-backed command planning via RPC (`pi --mode rpc`)
- Policy gating for mutating actions
- Two-step approval (`plan` -> `approve` -> `execute`)
- Run transcript storage and retrieval
- Prometheus metrics endpoint
- Hyperlane core plans default to `--config configs/<chain>-core.yaml`.
- For EVM core deploy/apply, ops-agent auto-creates `configs/<chain>-core.yaml` from `configs/core-config.example.yaml` if missing, then rewrites `owner`/`beneficiary` from `HYP_KEY` before execution.

## Environment

- `PI_DEFAULT_PROVIDER` and `PI_DEFAULT_MODEL` set provider/model for Pi RPC process.
- `PI_PROJECT_CWD` (optional) overrides the cwd used to load Pi project settings/skills.
- `OPS_AGENT_STATE_FILE` (optional) sets custom state file path (default auto-resolves to `ops-agent/state/store.json` from repo root, or `state/store.json` from inside `ops-agent`).
- `HYP_KEY` required for EVM mutating commands.
- `HYP_KEY_COSMOSNATIVE` required for cosmosnative mutating commands.
- Optional `PI_BIN` can point to a specific `pi` executable path.

## Project Pi Config

- Project settings and Hyperlane skills are stored at repo root in `.pi`.
- The planner auto-detects `.pi` from either repository root or `ops-agent/` working directory.
- If your layout differs, set `PI_PROJECT_CWD` to the directory containing `.pi/settings.json`.

## Authentication

The ops-agent needs LLM credentials for Pi planning.

### Option 1: OpenAI API key (recommended for headless/server use)

Set these values in `.env`:

```bash
OPENAI_API_KEY=sk-...
PI_DEFAULT_PROVIDER=openai
PI_DEFAULT_MODEL=gpt-5-codex
```

This is the simplest and most reliable mode for containerized operation.

### Option 2: ChatGPT/Codex OAuth (subscription-based, no API key)

Pi also supports ChatGPT subscription login (`openai-codex` provider):

```bash
cd ops-agent
npx pi
# then run: /login
# choose: ChatGPT Plus/Pro (Codex Subscription)
```

This creates OAuth credentials in `~/.pi/agent/auth.json`.

If ops-agent runs in Docker, mount that auth directory into the container so Pi can use/refresh tokens:

```yaml
services:
  ops-agent:
    volumes:
      - ~/.pi/agent:/root/.pi/agent
```

Then set:

```bash
PI_DEFAULT_PROVIDER=openai-codex
PI_DEFAULT_MODEL=gpt-5.1-codex
```

Notes:
- ChatGPT Business subscription does not always imply OpenAI API key access.
- `openai-codex` OAuth availability depends on account/workspace policy.
- If OAuth is not available in your workspace, use the API-key mode above.

## API

- `POST /v1/plan`
- `GET /v1/info`
- `POST /v1/approve`
- `POST /v1/execute`
- `GET /v1/plans/:id`
- `GET /v1/runs/:id`
- `GET /v1/runs/:id/events`
- `GET /healthz`
- `GET /metrics`

## Local development

```bash
cd ops-agent
npm install
npm run build
npm run test
npm run dev
```

## Install CLI to PATH

Install the `ops-agent` binary globally from this local package:

```bash
cd /Users/damiannolan/development/hyperlane-ops/ops-agent
npm install
npm run build
npm link
```

Verify:

```bash
which ops-agent
ops-agent plan "check relayer health" --host http://127.0.0.1:8787
```

If `ops-agent` is not found in your shell, add npm global bin to your `PATH` (zsh):

```bash
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Development note: `npm link` points to your local checkout, so after code changes run `npm run build` again.

Uninstall global link:

```bash
npm unlink -g hyperlane-ops-agent
```

## Run server with CLI

You can run the API server directly from the same binary:

```bash
ops-agent serve
```

Optional flags:

```bash
ops-agent serve --port 8787 --cwd /Users/damiannolan/development/hyperlane-ops
```

## CLI examples

```bash
# terminal 1: run server
ops-agent serve

# terminal 2: run client commands
ops-agent help
ops-agent help plan
ops-agent plan --help
ops-agent info
ops-agent info --json
ops-agent info --verify --json
ops-agent plan "check relayer health"
ops-agent run "diagnose relayer lag" --read-only
```

## Hyperlane Core Deploy Defaults

- Core deploy/apply/read plans should include `--chain <chain>` and `--config configs/<chain>-core.yaml`.
- Do not deploy directly with `configs/core-config.example.yaml`.
- During EVM core deploy/apply execution, ops-agent ensures `configs/<chain>-core.yaml` exists by copying `configs/core-config.example.yaml`.
- The `owner` and `beneficiary` fields in that file are rewritten to the EVM address derived from `HYP_KEY`.
- Owner address derivation uses `cast wallet address --private-key ...`, so Foundry `cast` must be installed on the host/container running ops-agent.

## Interactive workflow mode

The CLI supports interview-style workflows.

```bash
ops-agent add-chain --cwd /Users/damiannolan/development/hyperlane-ops
ops-agent hyperlane-core --cwd /Users/damiannolan/development/hyperlane-ops
ops-agent warp-route --cwd /Users/damiannolan/development/hyperlane-ops
```

Notes:
- `add-chain` is a built-in local wizard (no Pi dependency) and writes `chains/<name>/metadata.yaml` only after explicit confirmation.
- `hyperlane-core` and `warp-route` run Pi directly and continue as multi-turn interviews.
- Type `/exit` to stop an interactive workflow.
- Optional per-session overrides for Pi-backed workflows: `--provider`, `--model`, `--timeout`.
