import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderMetrics, resetMetricsRegistry } from "../../src/metrics/registry.js";
import type { AppConfig } from "../../src/types.js";

const createAgentSession = vi.fn();
const createBashTool = vi.fn();
const createCodingTools = vi.fn();
const createReadOnlyTools = vi.fn();
const open = vi.fn();
const create = vi.fn();

const readFile = vi.fn();
const writeFile = vi.fn();
const mkdir = vi.fn();

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession,
  createBashTool,
  createCodingTools,
  createReadOnlyTools,
  SessionManager: {
    open,
    create,
  },
}));

vi.mock("node:fs/promises", () => ({
  default: { readFile, writeFile, mkdir },
}));

const { PiSessionManager } = await import("../../src/agent/session-manager.js");

function cfg(): AppConfig {
  return {
    port: 8080,
    metricsPort: 9090,
    publicBaseUrl: "https://example.com",
    telegramBotToken: "t",
    telegramWebhookSecret: "s",
    telegramAllowedUserId: 1,
    logLevel: "INFO",
    repoOwner: "owner",
    reposRoot: "/workspace",
    repoNames: ["repo-one"],
    repoBaseBranch: "main",
    githubAppId: "1",
    githubAppPrivateKeyPem: "pem",
    sessionDir: "/tmp/sessions",
    isDev: true,
  };
}

beforeEach(() => {
  resetMetricsRegistry();
  createAgentSession.mockReset();
  createBashTool.mockReset();
  createCodingTools.mockReset();
  createReadOnlyTools.mockReset();
  open.mockReset();
  create.mockReset();
  readFile.mockReset();
  writeFile.mockReset();
  mkdir.mockReset();
});

describe("PiSessionManager", () => {
  it("creates and caches writable session, then returns cache hit", async () => {
    readFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    createCodingTools.mockReturnValue(["tools-rw"]);
    create.mockReturnValue("created-manager");
    createAgentSession.mockResolvedValue({
      session: { sessionFile: "/tmp/sessions/a.json", isStreaming: false, abort: vi.fn() },
    });

    const manager = new PiSessionManager(cfg());
    const first = await manager.getSession(7, true, "repo-one", "/workspace/repo-one");
    const second = await manager.getSession(7, true, "repo-one", "/workspace/repo-one");

    expect(first).toBe(second);
    expect(createCodingTools).toHaveBeenCalledWith("/workspace/repo-one");
    expect(create).toHaveBeenCalledWith("/workspace/repo-one", "/tmp/sessions");
    expect(writeFile).toHaveBeenCalledWith(
      "/tmp/sessions/session-index.json",
      expect.stringContaining('"7:rw:repo-one": "/tmp/sessions/a.json"'),
    );

    const metrics = await renderMetrics();
    expect(metrics).toContain('pi_session_get_total{mode="rw",cache="miss"} 1');
    expect(metrics).toContain('pi_session_get_total{mode="rw",cache="hit"} 1');
  });

  it("opens existing read-only session from index with read-only + web tools and records read IO error", async () => {
    readFile
      .mockRejectedValueOnce(new Error("broken json"))
      .mockResolvedValueOnce('{"5:ro:repo-two":"/tmp/sessions/existing.json"}');
    createReadOnlyTools.mockReturnValue(["tools-ro"]);
    createBashTool.mockReturnValue({ name: "bash-mock", execute: vi.fn() });
    open.mockReturnValue("opened-manager");
    createAgentSession.mockResolvedValue({
      session: { sessionFile: undefined, isStreaming: false, abort: vi.fn() },
    });

    const manager = new PiSessionManager(cfg());
    await manager.getSession(5, false, "repo-one", "/workspace/repo-one");
    await manager.getSession(5, false, "repo-two", "/workspace/repo-two");

    expect(createReadOnlyTools).toHaveBeenCalledWith("/workspace/repo-one");
    // Read-only tools + web tool (which wraps createBashTool internally)
    const firstCallTools = createAgentSession.mock.calls[0][0].tools;
    expect(firstCallTools).toHaveLength(2);
    expect(firstCallTools[0]).toBe("tools-ro");
    expect(firstCallTools[1]).toHaveProperty("name", "web");
    expect(open).toHaveBeenCalledWith("/tmp/sessions/existing.json");
    const metrics = await renderMetrics();
    expect(metrics).toContain('pi_session_index_io_errors_total{op="read"} 1');
  });

  it("propagates write errors and records metric", async () => {
    readFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    createCodingTools.mockReturnValue(["tools-rw"]);
    create.mockReturnValue("created-manager");
    createAgentSession.mockResolvedValue({
      session: { sessionFile: "/tmp/sessions/new.json", isStreaming: false, abort: vi.fn() },
    });
    mkdir.mockRejectedValue(new Error("mkdir failed"));

    const manager = new PiSessionManager(cfg());
    await expect(manager.getSession(1, true, "repo-one", "/workspace/repo-one")).rejects.toThrow("mkdir failed");

    const metrics = await renderMetrics();
    expect(metrics).toContain('pi_session_index_io_errors_total{op="write"} 1');
  });
});
