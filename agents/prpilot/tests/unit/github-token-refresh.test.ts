import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type { AppConfig } from "../../src/types.js";

const readFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  default: { readFile },
}));

const { GitHubTokenProvider } = await import("../../src/github/token-refresh.js");

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 8080,
    metricsPort: 9090,
    publicBaseUrl: "https://example.com",
    telegramBotToken: "t",
    telegramWebhookSecret: "secret",
    telegramAllowedUserId: 1,
    logLevel: "INFO",
    repoOwner: "auricom",
    reposRoot: "/workspace",
    repoNames: ["repo-one"],
    repoBaseBranch: "main",
    githubAppId: "123",
    githubAppPrivateKeyPem: "",
    sessionDir: "/tmp/sessions",
    isDev: true,
    ...overrides,
  };
}

beforeEach(() => {
  readFile.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GitHubTokenProvider", () => {
  it("refreshes token and serves cached token for same repo", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const keyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 77 }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: "tok-1", expires_at: "2099-01-01T00:00:00Z" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GitHubTokenProvider(baseConfig({ githubAppPrivateKeyPem: keyPem }));
    const first = await provider.getToken("repo-one");
    const second = await provider.getToken("repo-one");

    expect(first).toBe("tok-1");
    expect(second).toBe("tok-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forces refresh and refreshes when repo changes", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const keyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 10 }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: "tok-a", expires_at: "2099-01-01T00:00:00Z" }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 11 }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: "tok-b", expires_at: "2099-01-01T00:00:00Z" }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 11 }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: "tok-c", expires_at: "2099-01-01T00:00:00Z" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GitHubTokenProvider(baseConfig({ githubAppPrivateKeyPem: keyPem }));

    expect(await provider.getToken("repo-one")).toBe("tok-a");
    expect(await provider.getToken("repo-two")).toBe("tok-b");
    expect(await provider.forceRefresh("repo-two")).toBe("tok-c");
  });

  it("reads private key from path and falls back to installations endpoint on 404", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const keyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    readFile.mockResolvedValue(keyPem);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 404, json: async () => ({ message: "missing" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 88 }] })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: "tok-path", expires_at: "invalid-date" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GitHubTokenProvider(
      baseConfig({
        githubAppPrivateKeyPem: undefined,
        githubAppPrivateKeyPath: "/tmp/key.pem",
      }),
    );

    expect(await provider.getToken("repo-one")).toBe("tok-path");
    expect(readFile).toHaveBeenCalledWith("/tmp/key.pem", "utf8");
  });

  it("throws for multiple installations and api errors", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const keyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

    const multipleInstallationsFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 404, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1 }, { id: 2 }] });
    vi.stubGlobal("fetch", multipleInstallationsFetch);

    const provider = new GitHubTokenProvider(baseConfig({ githubAppPrivateKeyPem: keyPem }));
    await expect(provider.getToken("repo-one")).rejects.toThrow("Multiple installations found");

    const noInstallationsFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 404, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });
    vi.stubGlobal("fetch", noInstallationsFetch);
    const providerNoInstall = new GitHubTokenProvider(baseConfig({ githubAppPrivateKeyPem: keyPem }));
    await expect(providerNoInstall.getToken("repo-one")).rejects.toThrow("No GitHub App installations found");

    const missingTokenFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 99 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ expires_at: "2099-01-01T00:00:00Z" }) });
    vi.stubGlobal("fetch", missingTokenFetch);
    const providerMissingToken = new GitHubTokenProvider(baseConfig({ githubAppPrivateKeyPem: keyPem }));
    await expect(providerMissingToken.getToken("repo-one")).rejects.toThrow("response missing token");

    const failingFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 99 }) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ message: "bad auth" }) });
    vi.stubGlobal("fetch", failingFetch);

    const provider2 = new GitHubTokenProvider(baseConfig({ githubAppPrivateKeyPem: keyPem }));
    await expect(provider2.getToken("repo-one")).rejects.toThrow("GitHub API error 401: bad auth");

    const noKeyProvider = new GitHubTokenProvider(
      baseConfig({ githubAppPrivateKeyPem: undefined, githubAppPrivateKeyPath: undefined }),
    );
    await expect(noKeyProvider.getToken("repo-one")).rejects.toThrow("No GitHub app private key available");
  });
});
