# Agent Submission

## Author

randygrok (Javier Gimeno)

## Agent Name

RepoRadar

## One-Line Description

Multi-repo triage agent that scans GitHub repositories and tells you what needs your attention right now.

## What job does this agent own?

Scan a configured list of GitHub repositories, find open PRs (especially those pending your review or with failing CI), detect stale/forgotten issues, and produce a prioritized report of what you should look at first.

## Why should this be an agent?

A script can fetch the data, but the value is in **prioritization and summarization**. The agent reasons about what matters: a PR waiting 5 days for your review is more urgent than one opened an hour ago. An issue with no assignee and no comments for 3 weeks is likely forgotten. A failing CI check on a flaky test is different from a real build failure. These judgments require reasoning over messy, contextual data.

## What tools does the agent use?

- `list_open_prs` — List all open PRs for a repository
- `list_pending_reviews` — Find PRs where the user is requested as reviewer
- `list_pr_checks` — Get CI/CD check status for a specific PR
- `list_open_issues` — List all open issues for a repository
- `list_stale_issues` — Find issues with no activity for N days (configurable threshold)
- `get_pr_details` — Get detailed info about a specific PR (description, files, reviews, comments)

All tools use the `gh` CLI under the hood.

## What framework or stack did you use?

Pi Agent (`@mariozechner/pi-agent-core`) with multi-provider support via `@mariozechner/pi-ai`.

Supported providers:
- **OAuth (subscription-based):** Anthropic (Claude Pro/Max), GitHub Copilot, OpenAI Codex, Google Gemini CLI
- **API key:** Google Gemini, OpenAI, OpenRouter

## What are the boundaries?

- **What can it do automatically?** Read data from GitHub (PRs, issues, checks, reviews). Summarize and prioritize.
- **What requires human approval?** Nothing — the agent is fully read-only.
- **What should make it stop or escalate?** GitHub API failures, authentication issues, or repos it cannot access.

## How do you evaluate it?

- Does it correctly identify PRs pending my review?
- Does it catch stale issues I had forgotten about?
- Does the prioritization match what I'd do manually?
- Time saved vs. opening each repo's PR/issue page individually.

## What level is this agent?

Level 1: Agent with instructions and tools. No persistent storage or memory needed — it fetches fresh data on each run.

## Demo / How to Run

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [GitHub CLI](https://cli.github.com/) installed and authenticated (`gh auth status`)

### First run (interactive setup)

```bash
cd agents/randygrok
npm install
npm start
```

On first launch, RepoRadar walks you through setup:

1. **GitHub username** — your handle
2. **Repositories** — enter repos one by one (`owner/repo`), empty line to finish
3. **Stale threshold** — days without activity to flag an issue (default: 14)
4. **AI provider** — pick from the list (Anthropic, Copilot, Codex, Gemini, etc.)
5. **Model** — choose a model available for that provider

If you pick an OAuth provider (Anthropic, Copilot, Codex, Gemini CLI), it will open a browser for login. Everything is saved to `config.json` and `auth.json` for next time.

### Subsequent runs

```bash
npm start
```

Starts directly with your saved configuration.

### Usage

```
You: scan my repos
You: what PRs need my review?
You: any stale or forgotten issues?
You: give me a full report
You: tell me about PR #42 in owner/repo
You: quit
```

### Reconfigure

Delete `config.json` and run `npm start` again to re-run the setup wizard.

## Lessons Learned

<!-- To be filled after testing -->
