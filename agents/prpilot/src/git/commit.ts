import type { RepoContext } from "../types.js";
import { assertSuccess, execCommand } from "../utils/exec.js";
import { logger } from "../utils/logger.js";
import { createApiCommit } from "../github/commit-api.js";

export async function commitAll(
  repo: RepoContext,
  branch: string,
  message: string,
  token: string,
): Promise<{ changed: boolean; summary: string }> {
  logger.debug("staging changes for commit");
  const add = await execCommand("git", ["add", "-A"], { cwd: repo.repoPath });
  assertSuccess(add, "git add");

  const status = await execCommand("git", ["status", "--porcelain"], { cwd: repo.repoPath });
  assertSuccess(status, "git status");

  if (!status.stdout.trim()) {
    logger.debug("no git changes detected after apply");
    return { changed: false, summary: "No changes detected." };
  }

  logger.debug("creating commit via github api", { message });
  const { summary } = await createApiCommit(repo, branch, message, token);
  logger.debug("commit created via github api", { summaryLength: summary.length });

  return { changed: true, summary };
}
