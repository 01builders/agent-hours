import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";

export interface RenderPullRequestBodyInput {
  repoPath: string;
  sessionDir: string;
  task: string;
  agentSummary: string;
  commitSummary: string;
  branch: string;
  baseBranch: string;
  repoName: string;
  repoOwner: string;
}

type TemplateSource = "repo" | "global" | "default";

const templateKeyMap = {
  task: "task",
  agent_summary: "agentSummary",
  commit_summary: "commitSummary",
  branch: "branch",
  base_branch: "baseBranch",
  repo_name: "repoName",
  repo_owner: "repoOwner",
} as const;

export async function renderPullRequestBody(input: RenderPullRequestBodyInput): Promise<string> {
  const fallback = defaultPullRequestBody(input);

  try {
    const resolved = await resolveTemplate(input.repoPath, input.sessionDir);
    if (resolved.source === "default") {
      logger.debug("pr body template source selected", { source: resolved.source });
      return fallback;
    }

    logger.debug("pr body template source selected", {
      source: resolved.source,
      templatePath: resolved.templatePath,
    });

    const rendered = renderTemplate(resolved.template, input);
    return rendered;
  } catch (error) {
    logger.warn("failed to render pr body template; using default", {
      error: (error as Error).message,
    });
    return fallback;
  }
}

async function resolveTemplate(repoPath: string, sessionDir: string): Promise<
  | { source: "repo"; templatePath: string; template: string }
  | { source: "global"; templatePath: string; template: string }
  | { source: "default" }
> {
  const repoTemplatePath = path.join(repoPath, ".prpilot", "pr-body-template.md");
  const globalTemplatePath = path.join(sessionDir, "pr-body-template.md");

  const repoTemplate = await readTemplateIfExists(repoTemplatePath);
  if (repoTemplate !== null) {
    return { source: "repo", templatePath: repoTemplatePath, template: repoTemplate };
  }

  const globalTemplate = await readTemplateIfExists(globalTemplatePath);
  if (globalTemplate !== null) {
    return { source: "global", templatePath: globalTemplatePath, template: globalTemplate };
  }

  return { source: "default" };
}

async function readTemplateIfExists(templatePath: string): Promise<string | null> {
  try {
    return await fs.readFile(templatePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function renderTemplate(template: string, input: RenderPullRequestBodyInput): string {
  return template.replace(/{{\s*([a-z_]+)\s*}}/g, (fullMatch, key: string) => {
    const mappedKey = templateKeyMap[key as keyof typeof templateKeyMap];
    if (!mappedKey) return fullMatch;
    const value = input[mappedKey];
    return value ?? fullMatch;
  });
}

const defaultTemplate = `## Summary

- {{task}}
- Repo: \`{{repo_owner}}/{{repo_name}}\`
- Branch: \`{{branch}}\` → \`{{base_branch}}\`

## Changes

| Area | What changed |
|---|---|
| Scope | {{task}} |
| Code | See commit summary below |

## Validation

- CI: check this PR status
- Quick note: see agent summary in details

## Deploy

- Rollout: standard deploy
- Rollback: revert this PR

<details>
<summary><strong>Implementation details</strong></summary>

### Agent summary
{{agent_summary}}

### Commit summary
{{commit_summary}}

</details>`;

function defaultPullRequestBody(input: RenderPullRequestBodyInput): string {
  return renderTemplate(defaultTemplate, input);
}
