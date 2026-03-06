import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type TelegramClient } from "../../src/app.js";
import { renderMetrics, resetMetricsRegistry } from "../../src/metrics/registry.js";
import type { AppConfig } from "../../src/types.js";

let updateIdSeq = 1000;

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 8080,
    publicBaseUrl: "https://example.com",
    telegramBotToken: "bot-token",
    telegramWebhookSecret: "secret-token",
    telegramAllowedUserId: 42,
    logLevel: "ERROR",
    repoOwner: "owner",
    reposRoot: "/tmp",
    repoNames: ["repo-one", "repo-two"],
    repoBaseBranch: "main",
    githubAppId: "123",
    githubAppPrivateKeyPem: "pem",
    githubAppPrivateKeyPath: undefined,
    githubAppInstallationId: undefined,
    sessionDir: path.join(os.tmpdir(), `prpilot-test-${process.pid}-${Math.random().toString(16).slice(2)}`),
    isDev: true,
    ...overrides,
  };
}

function makeUpdate(text: string, userId = 42, chatId = 99): object {
  updateIdSeq += 1;
  return {
    update_id: updateIdSeq,
    message: {
      text,
      from: { id: userId },
      chat: { id: chatId },
    },
  };
}

function mockTelegram(): TelegramClient {
  return {
    sendMessage: vi.fn(async () => {}),
    sendChatAction: vi.fn(async () => {}),
    setWebhook: vi.fn(async () => {}),
    getWebhookInfo: vi.fn(async () => ({})),
    setMyCommands: vi.fn(async () => {}),
    deleteMyCommands: vi.fn(async () => {}),
  };
}

function makeApplyReadyDeps(telegram: TelegramClient, execCommandImpl: (args: string[]) => { code: number; stdout: string; stderr: string }) {
  return {
    telegram,
    piRunner: {
      run: vi.fn(async () => "run output"),
      getLastChatSummary: vi.fn(async () => null),
    },
    sessionManager: { abort: vi.fn(async () => false) },
    tokenProvider: {
      getToken: vi.fn(async () => "token"),
      forceRefresh: vi.fn(async () => "token-2"),
    },
    createFeatureBranch: vi.fn(async () => "agent/branch"),
    commitAll: vi.fn(async () => ({ changed: true, summary: "summary" })),
    pushBranch: vi.fn(async () => {}),
    createPullRequest: vi.fn(async () => "https://github.com/owner/repo/pull/1"),
    execCommand: vi.fn(async (_command: string, args: string[]) => execCommandImpl(args)),
  };
}

async function waitForTaskHistoryEntry(sessionDir: string, needle: string): Promise<void> {
  const filePath = path.join(sessionDir, "task-history.json");
  const timeoutMs = 1000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      if (raw.includes(needle)) return;
    } catch {
      // wait for first write
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for task history entry: ${needle}`);
}

async function waitForCondition(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}

describe("telegram webhook integration", () => {
  beforeEach(() => {
    resetMetricsRegistry();
  });

  it("rejects invalid route token", async () => {
    const telegram = mockTelegram();
    const { app } = createApp(testConfig(), { telegram });

    const response = await request(app)
      .post("/telegram/webhook/wrong")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/status"));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ ok: false });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects invalid header secret", async () => {
    const telegram = mockTelegram();
    const { app } = createApp(testConfig(), { telegram });

    const response = await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "wrong")
      .send(makeUpdate("/status"));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ ok: false });
  });

  it("sends unauthorized response for unknown user", async () => {
    const telegram = mockTelegram();
    const { app } = createApp(testConfig(), { telegram });

    const response = await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/status", 7));

    expect(response.status).toBe(200);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      "⛔ <b>Unauthorized</b>\nThis bot is restricted to approved users.",
      "HTML",
    );
  });

  it("handles /status", async () => {
    const telegram = mockTelegram();
    const { app } = createApp(testConfig(), {
      telegram,
      currentBranch: vi.fn(async () => "main"),
    });

    const response = await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/status"));

    expect(response.status).toBe(200);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      "🩺 <b>Status</b>\n✅ <b>Health</b>: healthy\n📦 <b>Repo</b>: none (use <code>/repo &lt;name&gt;</code>; supported: repo-one, repo-two)\n📁 <b>Branch</b>: <code>none</code>\n🧭 <b>Task</b>: none",
      "HTML",
    );
  });

  it("blocks chat when repository is not selected", async () => {
    const telegram = mockTelegram();
    const { app } = createApp(testConfig(), {
      telegram,
      piRunner: { run: vi.fn(async () => "Plan output"), getLastChatSummary: vi.fn(async () => null) },
    });

    const response = await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("deploy seasonpackerr"));

    expect(response.status).toBe(200);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      "❓ <b>Select Repository First</b>\nUse <code>/repo &lt;name&gt;</code>\nSupported: <code>repo-one, repo-two</code>",
      "HTML",
    );
  });

  it("shows recent tasks via /tasks", async () => {
    const telegram = mockTelegram();
    const execCommand = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { code: 0, stdout: "true\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const { app } = createApp(testConfig(), {
      telegram,
      piRunner: { run: vi.fn(async () => "Plan output"), getLastChatSummary: vi.fn(async () => null) },
      currentBranch: vi.fn(async () => "main"),
      execCommand,
    });

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-one"));

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/status"));

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("📦 <b>Repo</b>: <code>repo-one</code>"),
      "HTML",
    );

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("deploy seasonpackerr"));

    const response = await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/tasks"));

    expect(response.status).toBe(200);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("🗂️ <b>Tasks</b>"),
      "HTML",
    );
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("Plan output"),
      "HTML",
    );
  });

  it("runs apply from the latest chat summary", async () => {
    const telegram = mockTelegram();
    const piRunner = {
      run: vi.fn(async () => "run output"),
      getLastChatSummary: vi.fn(async () => "previous chat summary"),
    };
    const deps = {
      telegram,
      piRunner,
      sessionManager: { abort: vi.fn(async () => false) },
      tokenProvider: {
        getToken: vi.fn(async () => "token"),
        forceRefresh: vi.fn(async () => "token-2"),
      },
      createFeatureBranch: vi.fn(async () => "agent/branch"),
      commitAll: vi.fn(async () => ({ changed: true, summary: "summary" })),
      pushBranch: vi.fn(async () => {}),
      createPullRequest: vi.fn(async () => "https://github.com/owner/repo/pull/1"),
      execCommand: vi.fn(async (_command: string, args: string[]) => {
        if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return { code: 0, stdout: "true\n", stderr: "" };
        if (args[0] === "rev-list") return { code: 0, stdout: "1\n", stderr: "" };
        if (args[0] === "ls-remote") return { code: 0, stdout: "abc\n", stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      }),
    };

    const { app } = createApp(testConfig(), deps);

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-one"));

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("design a change"));

    await waitForCondition(() => piRunner.run.mock.calls.length > 0);

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/apply"));

    await waitForCondition(() => piRunner.run.mock.calls.length > 1);

    expect(piRunner.run.mock.calls[1]).toHaveLength(5);
    expect(piRunner.run.mock.calls[1][1]).toBe("apply");
  });

  it("stops apply when no commits are ahead of base", async () => {
    const telegram = mockTelegram();
    const deps = makeApplyReadyDeps(telegram, (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return { code: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "rev-list") return { code: 0, stdout: "0\n", stderr: "" };
      if (args[0] === "ls-remote") return { code: 0, stdout: "abc\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });

    const { app } = createApp(testConfig(), deps);

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-one"));

    const response = await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/apply add tests"));

    expect(response.status).toBe(200);
    expect(deps.commitAll).toHaveBeenCalledWith(
      expect.objectContaining({ repoOwner: "owner", repoName: "repo-one", repoPath: "/tmp/repo-one" }),
      "agent/branch",
      expect.stringContaining("add tests"),
      "token",
    );
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("No commits ahead of main; refusing to create PR."),
      "HTML",
    );
  });

  it("stops apply when remote branch is missing after push", async () => {
    const telegram = mockTelegram();
    const deps = makeApplyReadyDeps(telegram, (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return { code: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "rev-list") return { code: 0, stdout: "1\n", stderr: "" };
      if (args[0] === "ls-remote") return { code: 0, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });

    const { app } = createApp(testConfig(), deps);

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-one"));

    const response = await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/apply add tests"));

    expect(response.status).toBe(200);
    expect(deps.commitAll).toHaveBeenCalledWith(
      expect.objectContaining({ repoOwner: "owner", repoName: "repo-one", repoPath: "/tmp/repo-one" }),
      "agent/branch",
      expect.stringContaining("add tests"),
      "token",
    );
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("Remote branch agent/branch not found after push; refusing to create PR."),
      "HTML",
    );
  });

  it("uses repo template when creating apply PR body", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "prpilot-template-integration-"));
    const reposRoot = path.join(root, "repos");
    const sessionDir = path.join(root, "session");
    const repoPath = path.join(reposRoot, "repo-one");
    await fs.mkdir(path.join(repoPath, ".prpilot"), { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".prpilot", "pr-body-template.md"),
      "task={{task}}\nsummary={{agent_summary}}\ncommit={{commit_summary}}\nbranch={{branch}}\nbase={{base_branch}}\nrepo={{repo_owner}}/{{repo_name}}",
      "utf8",
    );

    const telegram = mockTelegram();
    const deps = makeApplyReadyDeps(telegram, (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return { code: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "rev-list") return { code: 0, stdout: "1\n", stderr: "" };
      if (args[0] === "ls-remote") return { code: 0, stdout: "abc\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });

    const { app } = createApp(testConfig({ reposRoot, sessionDir }), deps);

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-one"));

    const response = await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/apply add tests"));

    expect(response.status).toBe(200);
    await waitForCondition(() => deps.createPullRequest.mock.calls.length > 0);
    expect(deps.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ repoOwner: "owner", repoName: "repo-one", repoPath }),
      "agent/branch",
      expect.stringContaining("add tests"),
      expect.stringContaining("task=add tests"),
      "token",
    );
  });

  it("uses global template fallback when repo template is absent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "prpilot-template-integration-"));
    const reposRoot = path.join(root, "repos");
    const sessionDir = path.join(root, "session");
    const repoPath = path.join(reposRoot, "repo-one");
    await fs.mkdir(repoPath, { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionDir, "pr-body-template.md"),
      "global-task={{task}}\nrepo={{repo_owner}}/{{repo_name}}\nbase={{base_branch}}",
      "utf8",
    );

    const telegram = mockTelegram();
    const deps = makeApplyReadyDeps(telegram, (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return { code: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "rev-list") return { code: 0, stdout: "1\n", stderr: "" };
      if (args[0] === "ls-remote") return { code: 0, stdout: "abc\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });

    const { app } = createApp(testConfig({ reposRoot, sessionDir }), deps);

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-one"));

    const response = await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/apply add tests"));

    expect(response.status).toBe(200);
    await waitForCondition(() => deps.createPullRequest.mock.calls.length > 0);
    expect(deps.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ repoOwner: "owner", repoName: "repo-one", repoPath }),
      "agent/branch",
      expect.stringContaining("add tests"),
      expect.stringContaining("global-task=add tests"),
      "token",
    );
  });

  it("persists selected repository across app restart", async () => {
    const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "prpilot-"));
    const execCommand = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { code: 0, stdout: "true\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    const firstTelegram = mockTelegram();
    const firstApp = createApp(testConfig({ sessionDir }), {
      telegram: firstTelegram,
      execCommand,
    });

    const selectResponse = await request(firstApp.app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-two"));

    expect(selectResponse.status).toBe(200);
    expect(firstTelegram.sendMessage).toHaveBeenCalledWith(
      99,
      "✅ <b>Repository Selected</b>\n<code>repo-two</code>",
      "HTML",
    );

    const secondTelegram = mockTelegram();
    const secondApp = createApp(testConfig({ sessionDir }), {
      telegram: secondTelegram,
      currentBranch: vi.fn(async () => "main"),
    });

    const statusResponse = await request(secondApp.app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/status"));

    expect(statusResponse.status).toBe(200);
    expect(secondTelegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("📦 <b>Repo</b>: <code>repo-two</code>"),
      "HTML",
    );
  });

  it("converts markdown to HTML in chat responses", async () => {
    const telegram = mockTelegram();
    const execCommand = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { code: 0, stdout: "true\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const markdownOutput = "# Done\nUpdated **replicas** from `1` to `6`.\n```yaml\nreplicas: 6\n```";
    const { app } = createApp(testConfig(), {
      telegram,
      execCommand,
      piRunner: { run: vi.fn(async () => markdownOutput), getLastChatSummary: vi.fn(async () => null) },
    });

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-one"));

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("set replicas to 6"));

    await waitForCondition(() => {
      const calls = (telegram.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      return calls.some((c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("<b>Done</b>"));
    });

    const chatResponseCall = (telegram.sendMessage as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("<b>Done</b>"),
    );
    expect(chatResponseCall).toBeDefined();
    const html = chatResponseCall![1] as string;
    expect(html).toContain("<b>Done</b>");
    expect(html).toContain("<b>replicas</b>");
    expect(html).toContain("<code>1</code>");
    expect(html).toContain("<pre><code>replicas: 6</code></pre>");
    expect(html).not.toContain("**");
    expect(html).not.toContain("```");
  });

  it("persists tasks history across app restart and keeps latest entries", async () => {
    const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "prpilot-tasks-"));
    const execCommand = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { code: 0, stdout: "true\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    const firstTelegram = mockTelegram();
    const firstApp = createApp(testConfig({ sessionDir }), {
      telegram: firstTelegram,
      execCommand,
      piRunner: { run: vi.fn(async () => "Plan output"), getLastChatSummary: vi.fn(async () => null) },
    });

    await request(firstApp.app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-one"));

    await request(firstApp.app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("deploy app one"));

    await waitForTaskHistoryEntry(sessionDir, "deploy app one");

    const secondTelegram = mockTelegram();
    const secondApp = createApp(testConfig({ sessionDir }), {
      telegram: secondTelegram,
      currentBranch: vi.fn(async () => "main"),
    });

    const response = await request(secondApp.app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/tasks"));

    expect(response.status).toBe(200);
    expect(secondTelegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("Plan output"),
      "HTML",
    );
  });

  it("selects a planning task and continues it with subsequent messages", async () => {
    const telegram = mockTelegram();
    const execCommand = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { code: 0, stdout: "true\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const piRunner = {
      run: vi.fn(async () => "Authelia replicas analysis complete"),
      getLastChatSummary: vi.fn(async () => null),
    };
    const { app } = createApp(testConfig(), {
      telegram,
      execCommand,
      piRunner,
    });

    // Select repo and send initial message to create a planning task
    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-one"));

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("set authelia replicas to 6"));

    await waitForCondition(() => piRunner.run.mock.calls.length > 0);

    // Select task #1
    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/select 1"));

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("📌 <b>Task Selected</b>"),
      "HTML",
    );

    // Send follow-up message — should continue the same task, not create a new one
    piRunner.run.mockResolvedValueOnce("Updated plan with 6 replicas and resource limits");

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("also adjust the resource limits"));

    await waitForCondition(() => piRunner.run.mock.calls.length > 1);

    // Check /tasks — should show only 1 task, not 2
    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/tasks"));

    const tasksCall = (telegram.sendMessage as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("🗂️ <b>Tasks</b>"),
    );
    expect(tasksCall).toBeDefined();
    const tasksHtml = tasksCall![1] as string;
    // Should have exactly one "1." entry and no "2."
    expect(tasksHtml).toContain("1.");
    expect(tasksHtml).not.toContain("2.");
  });

  it("rejects selecting a non-planning task", async () => {
    const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "prpilot-select-"));
    const appliedHistory = [
      {
        repoName: "repo-one",
        label: "deploy app",
        title: "Deploy app",
        status: "applied",
        createdAt: new Date().toISOString(),
      },
    ];
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(path.join(sessionDir, "task-history.json"), JSON.stringify(appliedHistory));

    const telegram = mockTelegram();
    const { app } = createApp(testConfig({ sessionDir }), {
      telegram,
      currentBranch: vi.fn(async () => "main"),
    });

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/select 1"));

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("Cannot Select Task"),
      "HTML",
    );
  });

  it("deselects task with /select 0", async () => {
    const telegram = mockTelegram();
    const execCommand = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { code: 0, stdout: "true\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const { app } = createApp(testConfig(), {
      telegram,
      execCommand,
      piRunner: { run: vi.fn(async () => "Plan output"), getLastChatSummary: vi.fn(async () => null) },
    });

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-one"));

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("some task"));

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/select 1"));

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/select 0"));

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("Task Deselected"),
      "HTML",
    );
  });

  it("starts a new task with /new even when one is selected", async () => {
    const telegram = mockTelegram();
    const execCommand = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { code: 0, stdout: "true\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const piRunner = {
      run: vi.fn(async () => "Agent output"),
      getLastChatSummary: vi.fn(async () => null),
    };
    const { app } = createApp(testConfig(), { telegram, execCommand, piRunner });

    // Setup: repo + first task + select it
    await request(app).post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-one"));
    await request(app).post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("first task"));
    await waitForCondition(() => piRunner.run.mock.calls.length > 0);
    await request(app).post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/select 1"));

    // /new clears the selection
    await request(app).post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/new"));
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99, expect.stringContaining("✨ <b>Ready</b>"), "HTML",
    );

    // Next message creates a second task
    piRunner.run.mockResolvedValueOnce("Second task output");
    await request(app).post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("second task"));
    await waitForCondition(() => piRunner.run.mock.calls.length > 1);

    // /tasks should show 2 entries
    await request(app).post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/tasks"));
    const tasksCall = (telegram.sendMessage as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("🗂️ <b>Tasks</b>"),
    );
    expect(tasksCall).toBeDefined();
    expect(tasksCall![1] as string).toContain("1.");
    expect(tasksCall![1] as string).toContain("2.");
  });

  it("deletes a task with /delete and clears selection if active", async () => {
    const telegram = mockTelegram();
    const execCommand = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { code: 0, stdout: "true\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const piRunner = {
      run: vi.fn(async () => "Task output"),
      getLastChatSummary: vi.fn(async () => null),
    };
    const { app } = createApp(testConfig(), { telegram, execCommand, piRunner });

    // Create a task
    await request(app).post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-one"));
    await request(app).post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("deploy something"));
    await waitForCondition(() => piRunner.run.mock.calls.length > 0);

    // Select it
    await request(app).post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/select 1"));

    // Delete it
    await request(app).post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/delete 1"));
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99, expect.stringContaining("🗑️ <b>Task Deleted</b>"), "HTML",
    );

    // /tasks should show no tasks
    await request(app).post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/tasks"));
    const tasksCall = (telegram.sendMessage as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("No recent tasks"),
    );
    expect(tasksCall).toBeDefined();

    // /select should show no active task
    await request(app).post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/select"));
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99, expect.stringContaining("No Active Task"), "HTML",
    );
  });

  it("rejects /delete with invalid index", async () => {
    const telegram = mockTelegram();
    const { app } = createApp(testConfig(), { telegram });

    await request(app).post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/delete 99"));
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99, expect.stringContaining("Task Not Found"), "HTML",
    );
  });

  it("migrates legacy task history entries on load", async () => {
    const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "prpilot-migrate-"));
    const legacyHistory = [
      {
        repoName: "repo-one",
        label: "set replica for authelia at 6",
        slug: "set-replica-for-authelia-at-6",
        mode: "chat",
        status: "planned",
        summary: "Authelia replicas updated from **1 → 6**",
        createdAt: "2026-03-06T14:55:00.000Z",
      },
    ];
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(path.join(sessionDir, "task-history.json"), JSON.stringify(legacyHistory));

    const telegram = mockTelegram();
    const { app } = createApp(testConfig({ sessionDir }), {
      telegram,
      currentBranch: vi.fn(async () => "main"),
    });

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/tasks"));

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("📝 planning"),
      "HTML",
    );
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("Set replica for authelia at 6"),
      "HTML",
    );
  });

  it("records main app http metrics with templated route labels", async () => {
    const telegram = mockTelegram();
    const { app } = createApp(testConfig(), { telegram });

    await request(app).get("/healthz").expect(200);

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/status"))
      .expect(200);

    const metrics = await renderMetrics();
    expect(metrics).toContain('http_requests_total{method="GET",route="/healthz",status_code="200"} 1');
    expect(metrics).toContain('http_requests_total{method="POST",route="/telegram/webhook/:token",status_code="200"} 1');
    expect(metrics).toContain('http_request_duration_seconds_count{method="GET",route="/healthz",status_code="200"} 1');
  });
});
