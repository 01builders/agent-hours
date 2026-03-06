import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoContext } from "../../src/types.js";

const execCommand = vi.fn();
const readFile = vi.fn();

vi.mock("../../src/utils/exec.js", () => ({
  execCommand,
  assertSuccess: (result: { code: number; stderr: string; stdout: string }, context: string) => {
    if (result.code !== 0) throw new Error(`${context} failed (${result.code}): ${result.stderr || result.stdout}`);
  },
}));

vi.mock("node:fs/promises", () => ({
  default: { readFile },
}));

const { createApiCommit } = await import("../../src/github/commit-api.js");

function repo(): RepoContext {
  return {
    repoPath: "/tmp/repo",
    repoOwner: "owner",
    repoName: "repo",
    repoBaseBranch: "main",
  };
}

describe("createApiCommit", () => {
  beforeEach(() => {
    execCommand.mockReset();
    readFile.mockReset();
    vi.unstubAllGlobals();
  });

  it("rejects direct commit to base branch", async () => {
    await expect(createApiCommit(repo(), "main", "msg", "token")).rejects.toThrow(
      "Direct commits to main are forbidden",
    );
  });

  it("creates commit, updates existing remote ref, and returns summary", async () => {
    execCommand
      .mockResolvedValueOnce({ code: 0, stdout: "abc123parent\n", stderr: "" })
      .mockResolvedValueOnce({
        code: 0,
        stdout: "A\tnew.txt\nM\tmod.txt\nD\told.txt\nR100\toldname.txt\tnewname.txt\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: "100644 aa 0\tnew.txt\n100644 bb 0\tmod.txt\n100755 cc 0\tnewname.txt\n",
        stderr: "",
      })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    readFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith("new.txt")) return Buffer.from("new-file");
      if (filePath.endsWith("mod.txt")) return Buffer.from("mod-file");
      if (filePath.endsWith("newname.txt")) return Buffer.from("renamed-file");
      throw new Error(`unexpected read: ${filePath}`);
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ tree: { sha: "base-tree" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sha: "blob-new" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sha: "blob-mod" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sha: "blob-renamed" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sha: "tree-new" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sha: "abcdef1234567" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ object: { sha: "existing" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createApiCommit(repo(), "agent/feat", "feat: update", "token");

    expect(result.sha).toBe("abcdef1234567");
    expect(result.summary).toContain("abcdef1 feat: update");
    expect(result.summary).toContain("A  new.txt");
    expect(result.summary).toContain("M  mod.txt");
    expect(result.summary).toContain("D  old.txt");
    expect(result.summary).toContain("R  oldname.txt -> newname.txt");

    const treeCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/git/trees"));
    const treePayload = JSON.parse(String((treeCall as [string, RequestInit])[1].body));
    expect(treePayload.base_tree).toBe("base-tree");
    expect(treePayload.tree).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "old.txt", sha: null }),
        expect.objectContaining({ path: "oldname.txt", sha: null }),
        expect.objectContaining({ path: "newname.txt", mode: "100755", sha: "blob-renamed" }),
      ]),
    );

    expect(execCommand).toHaveBeenNthCalledWith(4, "git", ["fetch", "origin", "agent/feat"], { cwd: "/tmp/repo" });
    expect(execCommand).toHaveBeenNthCalledWith(5, "git", ["reset", "--hard", "FETCH_HEAD"], { cwd: "/tmp/repo" });
  });

  it("creates remote ref when branch does not exist", async () => {
    execCommand
      .mockResolvedValueOnce({ code: 0, stdout: "parent\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "A\tone.txt\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "100644 aa 0\tone.txt\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    readFile.mockResolvedValue(Buffer.from("hello"));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ tree: { sha: "tree-0" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sha: "blob-1" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sha: "tree-1" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sha: "commit-1" }) })
      .mockResolvedValueOnce({ ok: true, status: 404, json: async () => ({ message: "not found" }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    await createApiCommit(repo(), "agent/new-branch", "feat: one", "token");

    const createRefCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/git/refs"));
    const payload = JSON.parse(String((createRefCall as [string, RequestInit])[1].body));
    expect(payload).toEqual({ ref: "refs/heads/agent/new-branch", sha: "commit-1" });
  });
});
