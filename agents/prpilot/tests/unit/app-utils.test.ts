import { describe, expect, it, vi } from "vitest";
import { resetRepoToMain, truncateOneLine, truncateTelegram } from "../../src/app.js";
import type { RepoContext } from "../../src/types.js";

describe("truncateTelegram", () => {
  it("keeps short text intact", () => {
    expect(truncateTelegram(" hello ")).toBe("hello");
  });

  it("truncates very long text", () => {
    const text = "x".repeat(3900);
    const output = truncateTelegram(text);
    expect(output.endsWith("[truncated]")).toBe(true);
    expect(output.length).toBeGreaterThan(3800);
  });
});

describe("truncateOneLine", () => {
  it("normalizes whitespace", () => {
    expect(truncateOneLine("a   b\n c", 20)).toBe("a b c");
  });

  it("truncates when max is exceeded", () => {
    expect(truncateOneLine("abcdefgh", 5)).toBe("ab...");
  });
});

describe("resetRepoToMain", () => {
  it("runs fetch/checkout/reset/clean against main", async () => {
    const repo: RepoContext = {
      repoName: "home-ops",
      repoOwner: "auricom",
      repoPath: "/tmp/home-ops",
      repoBaseBranch: "main",
    };
    const exec = vi.fn()
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await resetRepoToMain(repo, exec);

    expect(exec).toHaveBeenNthCalledWith(1, "git", ["fetch", "origin", "--prune"], { cwd: "/tmp/home-ops" });
    expect(exec).toHaveBeenNthCalledWith(2, "git", ["checkout", "-B", "main", "origin/main"], { cwd: "/tmp/home-ops" });
    expect(exec).toHaveBeenNthCalledWith(3, "git", ["reset", "--hard", "origin/main"], { cwd: "/tmp/home-ops" });
    expect(exec).toHaveBeenNthCalledWith(4, "git", ["clean", "-fd"], { cwd: "/tmp/home-ops" });
  });
});
