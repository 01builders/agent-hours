import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoContext } from "../../src/types.js";

const execCommand = vi.fn();
const createApiCommit = vi.fn();

vi.mock("../../src/utils/exec.js", () => ({
  execCommand,
  assertSuccess: (result: { code: number; stderr: string; stdout: string }, context: string) => {
    if (result.code !== 0) throw new Error(`${context} failed (${result.code}): ${result.stderr || result.stdout}`);
  },
}));

vi.mock("../../src/github/commit-api.js", () => ({ createApiCommit }));

const { commitAll } = await import("../../src/git/commit.js");

function repo(): RepoContext {
  return {
    repoPath: "/tmp/repo",
    repoOwner: "owner",
    repoName: "repo",
    repoBaseBranch: "main",
  };
}

describe("commitAll", () => {
  beforeEach(() => {
    execCommand.mockReset();
    createApiCommit.mockReset();
  });

  it("returns changed=false when no staged changes", async () => {
    execCommand
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // git add
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // git status --porcelain

    const result = await commitAll(repo(), "agent/branch", "chore: update", "token");

    expect(result).toEqual({ changed: false, summary: "No changes detected." });
    expect(createApiCommit).not.toHaveBeenCalled();
  });

  it("delegates to createApiCommit with branch and token when changes exist", async () => {
    execCommand
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // git add
      .mockResolvedValueOnce({ code: 0, stdout: "M  kubernetes/app.yaml\n", stderr: "" }); // git status --porcelain
    createApiCommit.mockResolvedValue({
      sha: "abc1234def5678",
      summary: "abc1234 chore: update\nM  kubernetes/app.yaml",
    });

    const result = await commitAll(repo(), "agent/branch", "chore: update", "my-token");

    expect(createApiCommit).toHaveBeenCalledWith(
      expect.objectContaining({ repoOwner: "owner", repoName: "repo" }),
      "agent/branch",
      "chore: update",
      "my-token",
    );
    expect(result).toEqual({ changed: true, summary: "abc1234 chore: update\nM  kubernetes/app.yaml" });
  });
});
