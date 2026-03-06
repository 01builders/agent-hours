import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderPullRequestBody } from "../../src/git/pr-body-template.js";

const baseInput = {
  repoPath: "",
  sessionDir: "",
  task: "add template support",
  agentSummary: "updated apply flow",
  commitSummary: "2 files changed",
  branch: "agent/template-support",
  baseBranch: "main",
  repoName: "repo-one",
  repoOwner: "owner",
};

describe("renderPullRequestBody", () => {
  it("prefers repo template over global template", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pr-body-template-"));
    const repoPath = path.join(root, "repo");
    const sessionDir = path.join(root, "session");
    await fs.mkdir(path.join(repoPath, ".prpilot"), { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });

    await fs.writeFile(
      path.join(repoPath, ".prpilot", "pr-body-template.md"),
      "Repo template for {{task}} on {{branch}}",
      "utf8",
    );
    await fs.writeFile(path.join(sessionDir, "pr-body-template.md"), "Global template", "utf8");

    const body = await renderPullRequestBody({
      ...baseInput,
      repoPath,
      sessionDir,
    });

    expect(body).toBe("Repo template for add template support on agent/template-support");
  });

  it("uses global template when repo template is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pr-body-template-"));
    const repoPath = path.join(root, "repo");
    const sessionDir = path.join(root, "session");
    await fs.mkdir(repoPath, { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });

    await fs.writeFile(
      path.join(sessionDir, "pr-body-template.md"),
      "Global {{repo_owner}}/{{repo_name}} -> {{base_branch}}",
      "utf8",
    );

    const body = await renderPullRequestBody({
      ...baseInput,
      repoPath,
      sessionDir,
    });

    expect(body).toBe("Global owner/repo-one -> main");
  });

  it("uses built-in default when no template files exist", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pr-body-template-"));
    const repoPath = path.join(root, "repo");
    const sessionDir = path.join(root, "session");
    await fs.mkdir(repoPath, { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });

    const body = await renderPullRequestBody({
      ...baseInput,
      repoPath,
      sessionDir,
    });

    expect(body).toContain("## Summary");
    expect(body).toContain("- add template support");
    expect(body).toContain("- Repo: `owner/repo-one`");
    expect(body).toContain("## Changes");
    expect(body).toContain("| Scope | add template support |");
    expect(body).toContain("## Validation");
    expect(body).toContain("## Deploy");
    expect(body).toContain("### Agent summary");
    expect(body).toContain("updated apply flow");
    expect(body).toContain("### Commit summary");
    expect(body).toContain("2 files changed");
  });

  it("replaces supported placeholders and leaves unknown placeholders unchanged", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pr-body-template-"));
    const repoPath = path.join(root, "repo");
    const sessionDir = path.join(root, "session");
    await fs.mkdir(path.join(repoPath, ".prpilot"), { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });

    await fs.writeFile(
      path.join(repoPath, ".prpilot", "pr-body-template.md"),
      "{{task}}|{{agent_summary}}|{{commit_summary}}|{{branch}}|{{base_branch}}|{{repo_name}}|{{repo_owner}}|{{unknown}}",
      "utf8",
    );

    const body = await renderPullRequestBody({
      ...baseInput,
      repoPath,
      sessionDir,
    });

    expect(body).toBe(
      "add template support|updated apply flow|2 files changed|agent/template-support|main|repo-one|owner|{{unknown}}",
    );
  });

  it("falls back to built-in default when template read fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pr-body-template-"));
    const repoPath = path.join(root, "repo");
    const sessionDir = path.join(root, "session");
    await fs.mkdir(path.join(repoPath, ".prpilot"), { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });

    await fs.writeFile(path.join(repoPath, ".prpilot", "pr-body-template.md"), "{{task}}", "utf8");
    await fs.chmod(path.join(repoPath, ".prpilot", "pr-body-template.md"), 0o000);

    try {
      const body = await renderPullRequestBody({
        ...baseInput,
        repoPath,
        sessionDir,
      });

      expect(body).toContain("## Summary");
      expect(body).toContain("add template support");
    } finally {
      await fs.chmod(path.join(repoPath, ".prpilot", "pr-body-template.md"), 0o644);
    }
  });
});
