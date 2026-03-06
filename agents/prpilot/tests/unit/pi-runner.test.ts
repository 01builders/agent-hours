import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderMetrics, resetMetricsRegistry } from "../../src/metrics/registry.js";
import { PiRunner } from "../../src/agent/pi-runner.js";
import { TELEGRAM_REPOSITORY_SELF_SERVICE_RULES } from "../../src/agent/telegram-prompt-policy.js";

function createSessionEntry() {
  return {
    busy: false,
    session: {
      messages: [],
      prompt: vi.fn().mockResolvedValue(undefined),
      getLastAssistantText: vi.fn().mockReturnValue("ok"),
    },
  };
}

describe("PiRunner", () => {
  beforeEach(() => {
    resetMetricsRegistry();
  });

  it("builds a concise chat prompt with repository, tool, and Telegram guidance", async () => {
    const repoPath = await createRepoWithAgents("repo rules for chat");
    const entry = createSessionEntry();
    const getSession = vi.fn().mockResolvedValue(entry);
    const runner = new PiRunner({ getSession } as any);

    await runner.run(123, "chat", "change ingress", "home-ops", repoPath);

    const prompt = entry.session.prompt.mock.calls[0][0] as string;
    expect(prompt).toContain("Repository selected: home-ops");
    expect(prompt).toContain("repo rules for chat");
    expect(prompt).toContain("User message from Telegram:");
    expect(prompt).toContain("change ingress");
    for (const line of TELEGRAM_REPOSITORY_SELF_SERVICE_RULES) {
      expect(prompt).toContain(line);
    }
    expect(prompt).toContain("Respond for Telegram. Keep it concise and actionable.");
  });

  it("builds an apply prompt with repository, tool, and execution guidance", async () => {
    const repoPath = await createRepoWithAgents("repo rules for apply");
    const entry = createSessionEntry();
    const getSession = vi.fn().mockResolvedValue(entry);
    const runner = new PiRunner({ getSession } as any);

    await runner.run(123, "apply", "apply prompt body", "home-ops", repoPath);

    const prompt = entry.session.prompt.mock.calls[0][0] as string;
    expect(prompt).toContain("Repository selected: home-ops");
    expect(prompt).toContain("repo rules for apply");
    expect(prompt).toContain("Apply-mode task:");
    expect(prompt).toContain("apply prompt body");
    for (const line of TELEGRAM_REPOSITORY_SELF_SERVICE_RULES) {
      expect(prompt).toContain(line);
    }
    expect(prompt).toContain("Execute the task directly in the repository and summarize results for Telegram.");

    const metrics = await renderMetrics();
    expect(metrics).toContain('pi_runs_total{mode="apply",result="success"} 1');
    expect(metrics).toContain('pi_run_duration_seconds_count{mode="apply",result="success"} 1');
  });

  it("records busy run result metrics", async () => {
    const repoPath = await createRepoWithAgents("repo rules for busy");
    const entry = createSessionEntry();
    entry.busy = true;
    const getSession = vi.fn().mockResolvedValue(entry);
    const runner = new PiRunner({ getSession } as any);

    await expect(runner.run(123, "chat", "do stuff", "home-ops", repoPath)).rejects.toThrow("Session is busy");

    const metrics = await renderMetrics();
    expect(metrics).toContain('pi_runs_total{mode="chat",result="busy"} 1');
  });

  it("records empty-output and AGENTS.md failure metrics", async () => {
    const repoPath = await createRepoWithAgents("repo rules for empty output");
    const entry = createSessionEntry();
    entry.session.getLastAssistantText = vi.fn().mockReturnValue("");
    const getSession = vi.fn().mockResolvedValue(entry);
    const runner = new PiRunner({ getSession } as any);

    await runner.run(123, "chat", "do stuff", "home-ops", repoPath);

    const missingRepoPath = await fs.mkdtemp(path.join(os.tmpdir(), "pi-runner-missing-agents-"));
    await expect(runner.run(123, "chat", "do stuff", "home-ops", missingRepoPath)).rejects.toThrow("AGENTS.md is required");

    const metrics = await renderMetrics();
    expect(metrics).toContain('pi_runs_total{mode="chat",result="empty-output"} 1');
    expect(metrics).toContain('pi_runs_total{mode="chat",result="error"} 1');
    expect(metrics).toContain("pi_agents_md_load_failures_total 1");
  });
});

async function createRepoWithAgents(content: string): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "pi-runner-"));
  await fs.writeFile(path.join(repoPath, "AGENTS.md"), content, "utf8");
  return repoPath;
}
