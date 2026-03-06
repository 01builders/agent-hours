import fs from "node:fs/promises";
import path from "node:path";
import { assertSuccess, execCommand } from "../utils/exec.js";
import { logger } from "../utils/logger.js";
import type { RepoContext } from "../types.js";

interface TreeEntry {
  path: string;
  mode: "100644" | "100755" | "120000";
  type: "blob";
  sha: string | null;
}

interface ParsedFile {
  newPath: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
}

interface GitHubApiError {
  message?: string;
}

async function githubApiRequest<T>(
  url: string,
  init: RequestInit,
  token: string,
  options: { allow404?: boolean } = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> ?? {}),
    },
  });

  if (options.allow404 && response.status === 404) {
    return null as T;
  }

  const json = (await response.json()) as T | GitHubApiError;

  if (!response.ok) {
    throw new Error(`GitHub API error ${response.status}: ${(json as GitHubApiError).message ?? "unknown"}`);
  }

  return json as T;
}

function parseNameStatus(output: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  for (const line of output.split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    const status = parts[0]!;
    if (status.startsWith("R") || status.startsWith("C")) {
      files.push({ status: "renamed", oldPath: parts[1]!, newPath: parts[2]! });
    } else if (status === "D") {
      files.push({ status: "deleted", newPath: parts[1]! });
    } else if (status === "A") {
      files.push({ status: "added", newPath: parts[1]! });
    } else if (status === "M") {
      files.push({ status: "modified", newPath: parts[1]! });
    }
  }
  return files;
}

function parseLsFilesStage(output: string): Map<string, string> {
  const modeMap = new Map<string, string>();
  for (const line of output.split("\n").filter(Boolean)) {
    const tabIdx = line.indexOf("\t");
    if (tabIdx === -1) continue;
    const mode = line.slice(0, tabIdx).split(" ")[0]!;
    const filePath = line.slice(tabIdx + 1);
    modeMap.set(filePath, mode);
  }
  return modeMap;
}

export async function createApiCommit(
  repo: RepoContext,
  branch: string,
  message: string,
  token: string,
): Promise<{ sha: string; summary: string }> {
  if (branch === repo.repoBaseBranch) {
    throw new Error(`Direct commits to ${repo.repoBaseBranch} are forbidden; always use a feature branch`);
  }

  const baseUrl = `https://api.github.com/repos/${repo.repoOwner}/${repo.repoName}`;

  const headResult = await execCommand("git", ["rev-parse", "HEAD"], { cwd: repo.repoPath });
  assertSuccess(headResult, "git rev-parse HEAD");
  const parentSha = headResult.stdout.trim();
  logger.debug("api commit parent", { parentSha });

  const nameStatusResult = await execCommand(
    "git", ["diff", "--cached", "--name-status"], { cwd: repo.repoPath },
  );
  assertSuccess(nameStatusResult, "git diff --cached --name-status");
  const changedFiles = parseNameStatus(nameStatusResult.stdout);
  logger.debug("api commit staged files", { count: changedFiles.length });

  const lsFilesResult = await execCommand("git", ["ls-files", "--stage"], { cwd: repo.repoPath });
  assertSuccess(lsFilesResult, "git ls-files --stage");
  const modeMap = parseLsFilesStage(lsFilesResult.stdout);

  const parentCommit = await githubApiRequest<{ tree: { sha: string } }>(
    `${baseUrl}/git/commits/${parentSha}`,
    { method: "GET" },
    token,
  );
  const baseTreeSha = parentCommit.tree.sha;
  logger.debug("api commit base tree", { baseTreeSha });

  const treeEntries: TreeEntry[] = [];
  for (const file of changedFiles) {
    if (file.status === "deleted") {
      treeEntries.push({ path: file.newPath, mode: "100644", type: "blob", sha: null });
    } else {
      const paths = file.status === "renamed"
        ? [file.oldPath!, file.newPath]
        : [file.newPath];

      if (file.status === "renamed") {
        treeEntries.push({ path: file.oldPath!, mode: "100644", type: "blob", sha: null });
      }

      const filePath = paths[paths.length - 1]!;
      const content = await fs.readFile(path.join(repo.repoPath, filePath));
      const blob = await githubApiRequest<{ sha: string }>(
        `${baseUrl}/git/blobs`,
        { method: "POST", body: JSON.stringify({ content: content.toString("base64"), encoding: "base64" }) },
        token,
      );
      const mode = (modeMap.get(filePath) ?? "100644") as TreeEntry["mode"];
      treeEntries.push({ path: filePath, mode, type: "blob", sha: blob.sha });
    }
  }

  logger.debug("api commit creating tree", { entries: treeEntries.length });
  const tree = await githubApiRequest<{ sha: string }>(
    `${baseUrl}/git/trees`,
    { method: "POST", body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }) },
    token,
  );

  const commitResult = await githubApiRequest<{ sha: string }>(
    `${baseUrl}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message,
        tree: tree.sha,
        parents: [parentSha],
      }),
    },
    token,
  );
  const newCommitSha = commitResult.sha;
  logger.debug("api commit created", { sha: newCommitSha });

  const existingRef = await githubApiRequest<{ object: { sha: string } } | null>(
    `${baseUrl}/git/ref/heads/${branch}`,
    { method: "GET" },
    token,
    { allow404: true },
  );

  if (existingRef) {
    await githubApiRequest(
      `${baseUrl}/git/refs/heads/${branch}`,
      { method: "PATCH", body: JSON.stringify({ sha: newCommitSha }) },
      token,
    );
    logger.debug("api commit updated remote ref", { branch });
  } else {
    await githubApiRequest(
      `${baseUrl}/git/refs`,
      { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: newCommitSha }) },
      token,
    );
    logger.debug("api commit created remote ref", { branch });
  }

  const fetch = await execCommand("git", ["fetch", "origin", branch], { cwd: repo.repoPath });
  assertSuccess(fetch, "git fetch after api commit");
  const reset = await execCommand("git", ["reset", "--hard", "FETCH_HEAD"], { cwd: repo.repoPath });
  assertSuccess(reset, "git reset after api commit");

  const summary = changedFiles
    .map(f => {
      if (f.status === "renamed") return `R  ${f.oldPath} -> ${f.newPath}`;
      if (f.status === "deleted") return `D  ${f.newPath}`;
      if (f.status === "added") return `A  ${f.newPath}`;
      return `M  ${f.newPath}`;
    })
    .join("\n");

  return { sha: newCommitSha, summary: `${newCommitSha.slice(0, 7)} ${message}\n${summary}` };
}
