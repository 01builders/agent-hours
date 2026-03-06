---
name: Refactoring Agent — Implementation Plan
goal: Build a Level-1 autonomous agent using `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` that fetches GitHub PR diffs since its last run, synthesizes them with local skill docs, and opens a draft PR with prioritised refactoring suggestions.
created: 2026-03-06T16:35:45+01:00
progress: 0/0
---

# Refactoring Agent — Implementation Plan

**Goal:** Build a Level-1 autonomous agent using `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` that fetches GitHub PR diffs since its last run, synthesizes them with local skill docs, and opens a draft PR with prioritised refactoring suggestions.

**Architecture:** A standalone TypeScript project under `agent-hours/agents/refactoring-agent/`. The `Agent` class from `@mariozechner/pi-agent-core` is instantiated in `src/index.ts` with three `AgentTool` objects wrapping `@octokit/rest` (`list_prs`, `get_pr_diff`, `create_draft_pr`). A `state.json` file (gitignored) tracks `lastRunAt`. The system prompt (from `prompts/system.md`) is dynamically prepended with skill markdown files loaded via `src/skills.ts` — the domain context informs the LLM without modifying pi-mono internals.

---

## 8 Tasks at a Glance

### Task 1: Project scaffolding
**Key Output:** `package.json`, `tsconfig.json`, `.gitignore`

### Task 2: Config & state management
**Key Output:** `src/config.ts`, `src/state.ts`

### Task 3: GitHub API tools
**Key Output:** `src/tools/{list-prs,get-pr-diff,create-draft-pr}.ts`

### Task 4: Skills context loader
**Key Output:** `src/skills.ts`

### Task 5: System prompt
**Key Output:** `prompts/system.md`

### Task 6: Agent orchestrator
**Key Output:** `src/index.ts` — wires all pieces together

### Task 7: README & submission
**Key Output:** `README.md`, `SUBMISSION.md`

### Task 8: Unit tests
**Key Output:** `src/tools/list-prs.test.ts`, `vitest.config.ts`

---

## Key Design Decisions

- **`AgentTool` factory functions** (e.g. `makeListPrsTool(octokit, owner, repo, since)`) close over the Octokit client and `since` timestamp — the `Agent` sees clean, parameterless tools while the software layer handles state.
- **Skill loading at startup** — `loadSkills(dir)` reads all `.md` files from the configured skills directory and prepends them to the system prompt. This is the "knowledge injection" step that distinguishes this agent from a generic LLM call.
- **`state.json`** holds only `{ lastRunAt: string | null }` — minimal, easily inspectable, gitignored.
- **Error contract**: tools `throw` on GitHub API failures; pi-mono catches and reports these to the LLM as `isError: true` tool results, which naturally triggers graceful stopping per the operational boundaries in `plan.md`.
- **`google/gemini-3-flash`** is used as the model via `getModel("google", "gemini-3-flash")` — fast and cheap for a text-only synthesis task.
<!-- dispatch-status: task-1 = running -->
<!-- dispatch-status: task-2 = running -->
<!-- dispatch-status: task-3 = running -->
<!-- dispatch-status: task-4 = running -->
