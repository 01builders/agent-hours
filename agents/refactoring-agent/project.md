# Refactoring Agent Plan

Based on the agent-creation-guidelines, here is the plan for the refactoring agent project.

## 1. Define the Specialist
- **Exact job:** Review code changes and related PRs since the last run for the `ai_workspace/agent-hours/agents` repository, cross-reference with provided project Skills for background logic, and suggest high-impact, low-hanging refactoring opportunities.
- **Why an agent?** Requires reasoning to understand context from PRs, integration with GitHub APIs, and the ability to digest and apply multiple markdown Skills. A pure deterministic script cannot synthesize the "why" or prioritize high-impact changes effectively.
- **Why better?** A generalist LLM wouldn't have the context of the workspace's explicit skills or historical PR intent. This specialist explicitly loads this context before analyzing diffs.

## 2. Model vs. Software
- **Software:** 
    - Control loop: Fetching since-last-run commits and PRs via GitHub API.
    - Context Loading: Reading local `Skills` markdown files into context.
    - Side effects: Opening a Draft PR with the generated markdown document.
- **Model:** 
    - Summarizing PR intention and background.
    - Identifying and filtering high-impact refactorings.
    - Writing the suggestions in the target tone (direct to developers, explaining the "why", not too many suggestions).

## 3. Operational Boundaries
- **Automatic:** Executed manually (for now), fetching PRs, running the model analysis, and creating the draft PR.
- **Approval:** A human must view the generated Draft PR. The agent will NOT commit any refactoring code itself, only the markdown suggestions.
- **Stop/Escalate:** If the GitHub API fails, or the PR changes are too massive (exceeding context limits), it logs an error and exits gracefully without creating a PR.

## 4. Complexity Level
- **Level 1 (Instructions + Tools):** The software layer orchestrates the retrieval of PR diffs and Skills, constructs the prompt, and makes a single call to the LLM. 

## 5. Evaluation
- **Success Metrics:**
    - Accuracy and relevance of the refactoring suggestions: Are developers finding them high-impact and low-hanging?
    - Stability: Zero unhandled crashes during runs.
    - Adoption rate: How often the suggestions are manually implemented by the development team.

## Proposed Changes

We will create the new project at `/Users/alex/workspace/my/ai_workspace/agent-hours/agents/refactoring-agent`.

### [refactoring-agent] Component
#### [NEW] `refactoring-agent/package.json`
Dependencies, type definitions, and scripts (e.g., using Node.js/TypeScript).
#### [NEW] `refactoring-agent/src/index.ts`
The main orchestrator script that fetches GitHub API changes, reads local skills, calls the LLM, and creates the Draft PR for `ai_workspace/agent-hours/agents`.
#### [NEW] `refactoring-agent/prompts/system.md`
The instruction prompt that sets the strict bounds on the LLM output (focus on low-hanging fruit, targeting senior devs, explaining "why").

## TODOs / Future
- Evaluate and setup a scheduled trigger (GitHub Actions cron job, local cron, ag CLI auto-dispatch).
