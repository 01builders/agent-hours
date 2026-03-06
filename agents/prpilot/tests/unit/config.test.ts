import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

const ORIGINAL_ENV = { ...process.env };

function applyBaseEnv(): void {
  process.env = {
    ...ORIGINAL_ENV,
    PUBLIC_BASE_URL: "https://example.com",
    TELEGRAM_BOT_TOKEN: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    TELEGRAM_WEBHOOK_SECRET: "supersecret",
    TELEGRAM_ALLOWED_USER_ID: "42",
    REPO_OWNER: "auricom",
    REPOS_ROOT: "/workspace",
    REPO_NAMES: "repo-one,repo-two",
    REPO_BASE_BRANCH: "main",
    GITHUB_APP_ID: "123",
    GITHUB_APP_PRIVATE_KEY_PEM: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
  } as NodeJS.ProcessEnv;

  delete process.env.LOG_LEVEL;
  delete process.env.SESSION_DIR;
  delete process.env.NODE_ENV;
  delete process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  delete process.env.GITHUB_APP_INSTALLATION_ID;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("loadConfig", () => {
  it("loads config with defaults", () => {
    applyBaseEnv();

    const cfg = loadConfig();

    expect(cfg.port).toBe(8080);
    expect(cfg.metricsPort).toBe(9090);
    expect(cfg.logLevel).toBe("INFO");
    expect(cfg.repoNames).toEqual(["repo-one", "repo-two"]);
    expect(cfg.sessionDir).toBe("/data/sessions");
    expect(cfg.isDev).toBe(false);
  });

  it("parses optional values and development mode", () => {
    applyBaseEnv();
    process.env.PORT = "3000";
    process.env.METRICS_PORT = "9091";
    process.env.LOG_LEVEL = "DEBUG";
    process.env.SESSION_DIR = "/tmp/sessions";
    process.env.NODE_ENV = "development";
    process.env.GITHUB_APP_PRIVATE_KEY_PATH = "/tmp/key.pem";
    process.env.GITHUB_APP_INSTALLATION_ID = "999";

    const cfg = loadConfig();

    expect(cfg.port).toBe(3000);
    expect(cfg.metricsPort).toBe(9091);
    expect(cfg.logLevel).toBe("DEBUG");
    expect(cfg.sessionDir).toBe("/tmp/sessions");
    expect(cfg.isDev).toBe(true);
    expect(cfg.githubAppInstallationId).toBe("999");
    expect(cfg.githubAppPrivateKeyPath).toBe("/tmp/key.pem");
  });

  it("fails when no private key source is configured", () => {
    applyBaseEnv();
    delete process.env.GITHUB_APP_PRIVATE_KEY_PEM;
    delete process.env.GITHUB_APP_PRIVATE_KEY_PATH;

    expect(() => loadConfig()).toThrow("Either GITHUB_APP_PRIVATE_KEY_PATH or GITHUB_APP_PRIVATE_KEY_PEM must be set");
  });

  it("fails when REPO_NAMES contains duplicates", () => {
    applyBaseEnv();
    process.env.REPO_NAMES = "repo-one, repo-one";

    expect(() => loadConfig()).toThrow("REPO_NAMES must not contain duplicates");
  });

  it("fails when REPO_NAMES resolves to empty list", () => {
    applyBaseEnv();
    process.env.REPO_NAMES = " ,  ";

    expect(() => loadConfig()).toThrow("REPO_NAMES must include at least one repository name");
  });
});
