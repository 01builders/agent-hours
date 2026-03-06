import type { RepoContext } from "../types.js";
import { assertSuccess, execCommand } from "../utils/exec.js";
import { logger } from "../utils/logger.js";

export async function pushBranch(repo: RepoContext, branch: string, ghToken: string): Promise<void> {
  logger.debug("pushing branch", { branch });
  const push = await execCommand("git", ["push", "origin", `${branch}:refs/heads/${branch}`], {
    cwd: repo.repoPath,
    env: { GH_TOKEN: ghToken },
  });

  if (push.code !== 0 && /403|401|authentication/i.test(`${push.stderr} ${push.stdout}`)) {
    throw new Error("AUTH_FAILED");
  }
  assertSuccess(push, "git push");
  logger.debug("branch push complete", { branch });
}

export async function createPullRequest(
  repo: RepoContext,
  branch: string,
  title: string,
  body: string,
  ghToken: string,
): Promise<string> {
  logger.debug("creating pull request", { branch, base: repo.repoBaseBranch, titleLength: title.length });

  const args = [
    "pr",
    "create",
    "--base",
    repo.repoBaseBranch,
    "--head",
    `${repo.repoOwner}:${branch}`,
    "--title",
    title,
    "--body",
    body,
  ];

  const result = await execCommand("gh", args, {
    cwd: repo.repoPath,
    env: { GH_TOKEN: ghToken },
  });

  if (result.code !== 0 && /403|401|authentication/i.test(`${result.stderr} ${result.stdout}`)) {
    throw new Error("AUTH_FAILED");
  }
  assertSuccess(result, "gh pr create");

  const prUrl = result.stdout.trim();
  logger.debug("pull request created", { branch, prUrl });
  return prUrl;
}
