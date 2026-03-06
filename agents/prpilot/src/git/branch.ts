import type { RepoContext } from "../types.js";
import { assertSuccess, execCommand } from "../utils/exec.js";
import { logger } from "../utils/logger.js";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export async function createFeatureBranch(repo: RepoContext, task: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
  const branchName = `agent/${timestamp}-${slugify(task) || "task"}`;
  logger.debug("creating feature branch", { branchName });

  const fetch = await execCommand("git", ["fetch", "origin", repo.repoBaseBranch], { cwd: repo.repoPath });
  assertSuccess(fetch, "git fetch");

  const checkout = await execCommand(
    "git",
    ["checkout", "-B", branchName, `origin/${repo.repoBaseBranch}`],
    { cwd: repo.repoPath },
  );
  assertSuccess(checkout, "git checkout -B");

  return branchName;
}
