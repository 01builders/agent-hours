import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoContext } from "../../src/types.js";

const execCommand = vi.fn();

vi.mock("../../src/utils/exec.js", () => ({
  execCommand,
  assertSuccess: (result: { code: number; stderr: string; stdout: string }, context: string) => {
    if (result.code !== 0) throw new Error(`${context} failed (${result.code}): ${result.stderr || result.stdout}`);
  },
}));

const { createFeatureBranch } = await import("../../src/git/branch.js");

function repo(): RepoContext {
  return {
    repoPath: "/tmp/repo",
    repoOwner: "owner",
    repoName: "repo",
    repoBaseBranch: "main",
  };
}

describe("createFeatureBranch", () => {
  beforeEach(() => {
    execCommand.mockReset();
    execCommand.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  });

  it("creates sanitized feature branch from task text", async () => {
    const branch = await createFeatureBranch(repo(), "Fix API/Token + cleanup!!!");

    expect(branch).toMatch(/^agent\/\d{12}-fix-api-token-cleanup$/);
    expect(execCommand).toHaveBeenNthCalledWith(
      1,
      "git",
      ["fetch", "origin", "main"],
      { cwd: "/tmp/repo" },
    );
    expect(execCommand).toHaveBeenNthCalledWith(
      2,
      "git",
      ["checkout", "-B", branch, "origin/main"],
      { cwd: "/tmp/repo" },
    );
  });

  it("falls back to task slug when slugify produces empty text", async () => {
    const branch = await createFeatureBranch(repo(), "!!!");
    expect(branch).toMatch(/^agent\/\d{12}-task$/);
  });
});
