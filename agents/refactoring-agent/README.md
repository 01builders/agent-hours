# Refactoring Agent

An autonomous Level-1 agent that reviews merged GitHub PRs since its last run, synthesises the diffs with local skill documentation, and opens a draft PR with prioritised refactoring suggestions.

## Architecture

```
src/
├── index.ts          # Agent orchestrator (entry point)
├── config.ts         # Environment variable loading
├── state.ts          # Reads/writes state.json (lastRunAt)
├── skills.ts         # Loads markdown files from skills/ into system prompt
└── tools/
    ├── list-prs.ts         # makeListPrsTool — lists merged PRs since last run
    ├── get-pr-diff.ts      # makeGetPrDiffTool — fetches unified diff
    └── create-draft-pr.ts  # makeCreateDraftPrTool — creates the output draft PR
prompts/system.md     # System prompt template ({SKILLS} and {REPO} are replaced at runtime)
skills/               # Drop .md files here to give the agent domain context
state.json            # Gitignored — persists lastRunAt timestamp
```

**Model:** `gemini-2.5-flash` via `@mariozechner/pi-ai` + `@mariozechner/pi-agent-core`

## Setup

```bash
cp .env.example .env
# Fill in GITHUB_TOKEN, REPO_OWNER, REPO_NAME, GEMINI_API_KEY
npm install
```

## Running

```bash
npm run dev        # Quick run via tsx (no build needed)
npm run build      # Compile to dist/
npm start          # Run compiled output
```

## Adding Skills

Drop any `.md` file into the `skills/` directory. These are read at startup and injected into the system prompt, giving the agent project-specific domain context (coding conventions, architectural patterns, etc.).

## How It Works

1. Loads `state.json` to get `lastRunAt` (defaults to 7 days ago on first run)
2. Loads skill `.md` files and injects them into the system prompt
3. Starts the agent loop with three tools: `list_prs`, `get_pr_diff`, `create_draft_pr`  
4. The LLM lists PRs → fetches diffs → synthesises → creates a draft PR
5. Saves updated `lastRunAt` to `state.json`

## Tests

```bash
npm test
```
