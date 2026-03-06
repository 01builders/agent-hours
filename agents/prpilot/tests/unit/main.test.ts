import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/types.js";

function cfg(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 8080,
    metricsPort: 9090,
    publicBaseUrl: "https://example.com/",
    telegramBotToken: "token",
    telegramWebhookSecret: "secret",
    telegramAllowedUserId: 42,
    logLevel: "INFO",
    repoOwner: "owner",
    reposRoot: "/workspace",
    repoNames: ["repo-one", "repo-two"],
    repoBaseBranch: "main",
    githubAppId: "1",
    githubAppPrivateKeyPem: "pem",
    sessionDir: "/tmp/sessions",
    isDev: true,
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("main bootstrap", () => {
  it("bootstraps services and configures telegram webhook/commands", async () => {
    const appListen = vi.fn((_port, cb) => cb?.());
    const metricsListen = vi.fn((_port, cb) => cb?.());
    const metricsGet = vi.fn();
    const metricsApp = { get: metricsGet, listen: metricsListen };

    const telegram = {
      deleteMyCommands: vi.fn().mockRejectedValueOnce(new Error("ignore")).mockResolvedValue(undefined),
      setMyCommands: vi.fn().mockResolvedValue(undefined),
      setWebhook: vi.fn().mockResolvedValue(undefined),
      getWebhookInfo: vi.fn().mockResolvedValue({ pending_update_count: 2 }),
    };

    const longNames = ["x".repeat(260), "repo-two"];

    vi.doMock("node:fs/promises", () => ({ default: { mkdir: vi.fn().mockResolvedValue(undefined) } }));
    vi.doMock("express", () => ({ default: vi.fn(() => metricsApp) }));
    vi.doMock("../../src/config.js", () => ({ loadConfig: () => cfg({ repoNames: longNames }) }));
    vi.doMock("../../src/app.js", () => ({ createApp: () => ({ app: { listen: appListen }, telegram }) }));
    vi.doMock("../../src/metrics/registry.js", () => ({
      metricsContentType: "text/plain",
      renderMetrics: vi.fn().mockResolvedValue("ok"),
    }));
    vi.doMock("../../src/web/health.js", () => ({ registerHealthRoutes: vi.fn() }));

    await import("../../src/main.ts");
    await flush();

    expect(telegram.deleteMyCommands).toHaveBeenCalledTimes(4);
    expect(telegram.setWebhook).toHaveBeenCalledWith("https://example.com/telegram/webhook/secret", "secret");
    const commandPayload = telegram.setMyCommands.mock.calls[0][0] as Array<{ command: string; description: string }>;
    const repoCommand = commandPayload.find((c) => c.command === "repo");
    expect(repoCommand?.description.length).toBeLessThanOrEqual(256);
    expect(commandPayload.map((c) => c.command)).toEqual(["repo", "status", "tasks", "apply", "abort"]);
    expect(telegram.getWebhookInfo).toHaveBeenCalledTimes(1);
  });
});
