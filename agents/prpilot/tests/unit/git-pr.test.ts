import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoContext } from "../../src/types.js";

const execCommand = vi.fn();

vi.mock("../../src/utils/exec.js", () => ({
  execCommand,
  assertSuccess: (result: { code: number; stderr: string; stdout: string }, context: string) => {
    if (result.code !== 0) throw new Error(`${context} failed (${result.code}): ${result.stderr || result.stdout}`);
  },
}));

const { createPullRequest } = await import("../../src/git/pr.js");

function repo(): RepoContext {
  return {
    repoPath: "/tmp/repo",
    repoOwner: "owner",
    repoName: "repo",
    repoBaseBranch: "main",
  };
}

describe("createPullRequest", () => {
  beforeEach(() => {
    execCommand.mockReset();
  });

  it("uses explicit owner:branch in --head", async () => {
    execCommand.mockResolvedValue({ code: 0, stdout: "https://example/pr/1\n", stderr: "" });

    await createPullRequest(repo(), "agent/my-branch", "title", "body", "token");

    expect(execCommand).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["--head", "owner:agent/my-branch"]),
      expect.objectContaining({ cwd: "/tmp/repo" }),
    );
  });

  it("returns auth failure for authenticated push/pr errors", async () => {
    const { pushBranch } = await import("../../src/git/pr.js");

    execCommand.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "403 forbidden" });
    await expect(pushBranch(repo(), "agent/a", "token")).rejects.toThrow("AUTH_FAILED");

    execCommand.mockResolvedValueOnce({ code: 1, stdout: "authentication failed", stderr: "" });
    await expect(createPullRequest(repo(), "agent/a", "title", "body", "token")).rejects.toThrow("AUTH_FAILED");
  });

  it("pushes branch and returns pr url on success", async () => {
    const { pushBranch } = await import("../../src/git/pr.js");

    execCommand.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    await expect(pushBranch(repo(), "agent/ok", "token")).resolves.toBeUndefined();

    execCommand.mockResolvedValueOnce({ code: 0, stdout: "https://example/pr/55\n", stderr: "" });
    await expect(createPullRequest(repo(), "agent/ok", "title", "body", "token")).resolves.toBe("https://example/pr/55");
  });
});
