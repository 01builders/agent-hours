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
# Optional: FORK_OWNER, PR_ON_FORK, BASE_BRANCH
npm install
```

### GitHub Token Permissions

The `GITHUB_TOKEN` (Personal Access Token) requires specific permissions depending on your workflow:

#### Classic Token (ghp_...)
- **Required Scopes**: `repo` (Full control of private repositories).
- *Note:* This is required even for public repos if you intend to create branches or open PRs.

#### Fine-Grained Token (github_pat_...)
- **Repository Access**: Select your **fork** and the **original repository**.
- **Repository Permissions**:
  - `Contents`: **Read & write** (Required to read code from origin and create branches on fork).
  - `Pull requests`: **Read & write** (Required to open the draft PR).
  - `Metadata`: **Read-only** (Implicitly required).

> [!IMPORTANT]
> If the original repository belongs to an organization with SAML SSO, you must **manually authorize** the token for that organization after creation.

#### Working on a Fork
If you do not have write access to `REPO_OWNER/REPO_NAME`:
1. **Fork** the repository on GitHub.
2. Set `FORK_OWNER=your_username` in `.env`.
3. Set `PR_ON_FORK=true` if you cannot open PRs back to the original repository.
4. Ensure your PAT has **Write** access to your fork.

### Troubleshooting

#### Error: "Bad credentials"
This means the `GITHUB_TOKEN` is invalid. 
- Ensure the token is not **expired** or **revoked**.
- Double-check for **extra spaces** or **quotes** in your `.env` file.
- If the repository belongs to an organization, check if you need to **Authorize** the token for SAML SSO in your GitHub token settings.

#### Error: "Resource not accessible by personal access token"
This means the token is valid but lacks the required **scopes** or **repository access**.
- For branch creation, ensure the **Contents** permission is set to **Read & Write**.
- If using a fine-grained token with "Only select repositories", ensure **both** the origin and fork repositories are in the list.

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
