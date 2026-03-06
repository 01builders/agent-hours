import fs from "node:fs/promises";
import crypto from "node:crypto";
import type { AppConfig } from "../types.js";
import { logger } from "../utils/logger.js";

interface GitHubApiError {
  message?: string;
}

export class GitHubTokenProvider {
  private token?: string;
  private tokenExpiresAtEpochMs = 0;
  private tokenRepoName?: string;

  constructor(private readonly cfg: AppConfig) {}

  async getToken(repoName: string): Promise<string> {
    const now = Date.now();
    if (this.token && this.tokenRepoName === repoName && now < this.tokenExpiresAtEpochMs) {
      logger.debug("github token cache hit", {
        repoName,
        expiresInSec: Math.floor((this.tokenExpiresAtEpochMs - now) / 1000),
      });
      return this.token;
    }

    logger.debug("github token cache miss; refreshing token", { repoName });
    await this.refreshToken(repoName);
    if (!this.token) throw new Error("Failed to obtain GitHub App token");
    return this.token;
  }

  async forceRefresh(repoName: string): Promise<string> {
    logger.debug("github token force refresh requested", { repoName });
    this.token = undefined;
    this.tokenExpiresAtEpochMs = 0;
    this.tokenRepoName = undefined;
    return this.getToken(repoName);
  }

  private async refreshToken(repoName: string): Promise<void> {
    const privateKeyPem = await this.resolvePrivateKeyPem();
    const appJwt = createGitHubAppJwt(this.cfg.githubAppId, privateKeyPem);

    const installationId = this.cfg.githubAppInstallationId
      ? Number(this.cfg.githubAppInstallationId)
      : await this.discoverInstallationId(appJwt, repoName);

    logger.debug("requesting github installation token", { installationId });

    const tokenResult = await githubRequest<{ token: string; expires_at: string }>(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: authHeaders(appJwt),
      },
    );

    if (!tokenResult.token) {
      throw new Error("GitHub access_tokens response missing token");
    }

    this.token = tokenResult.token;
    this.tokenRepoName = repoName;

    // Refresh only when a token is about to be used and effectively expired.
    // Keep a tiny safety skew to avoid edge races around expiry.
    const expiresAt = Date.parse(tokenResult.expires_at);
    this.tokenExpiresAtEpochMs = Number.isNaN(expiresAt)
      ? Date.now() + 59 * 60 * 1000
      : Math.max(Date.now() + 30_000, expiresAt - 30_000);

    logger.debug("github token refreshed", {
      expiresAt: Number.isNaN(expiresAt) ? "unknown" : new Date(expiresAt).toISOString(),
    });
  }

  private async discoverInstallationId(jwtToken: string, repoName: string): Promise<number> {
    const repoInstall = await githubRequest<{ id: number }>(
      `https://api.github.com/repos/${this.cfg.repoOwner}/${repoName}/installation`,
      {
        method: "GET",
        headers: authHeaders(jwtToken),
      },
      { allow404: true },
    );

    if (repoInstall?.id) {
      logger.debug("github installation discovered from repository endpoint", { installationId: repoInstall.id });
      return repoInstall.id;
    }

    const installations = await githubRequest<Array<{ id: number; account?: { login?: string } }>>(
      "https://api.github.com/app/installations",
      {
        method: "GET",
        headers: authHeaders(jwtToken),
      },
    );

    if (!installations.length) {
      throw new Error("No GitHub App installations found for app");
    }

    if (installations.length === 1) {
      logger.debug("github installation discovered from app installations list", { installationId: installations[0]!.id });
      return installations[0]!.id;
    }

    throw new Error(
      "Multiple installations found; set GITHUB_APP_INSTALLATION_ID explicitly for deterministic auth",
    );
  }

  private async resolvePrivateKeyPem(): Promise<string> {
    if (this.cfg.githubAppPrivateKeyPem) {
      return this.cfg.githubAppPrivateKeyPem;
    }

    if (this.cfg.githubAppPrivateKeyPath) {
      return fs.readFile(this.cfg.githubAppPrivateKeyPath, "utf8");
    }

    throw new Error("No GitHub app private key available");
  }
}

function createGitHubAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlEncode({ iat: now - 60, exp: now + 540, iss: appId });
  const unsigned = `${header}.${payload}`;

  const signature = crypto.createSign("RSA-SHA256").update(unsigned).end().sign(privateKeyPem);
  const encodedSignature = signature.toString("base64url");

  return `${unsigned}.${encodedSignature}`;
}

function base64UrlEncode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function authHeaders(jwtToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${jwtToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function githubRequest<T>(
  url: string,
  init: RequestInit,
  options: { allow404?: boolean } = {},
): Promise<T> {
  const response = await fetch(url, init);

  if (options.allow404 && response.status === 404) {
    return null as T;
  }

  const json = (await response.json()) as T | GitHubApiError;

  if (!response.ok) {
    throw new Error(`GitHub API error ${response.status}: ${(json as GitHubApiError).message ?? "unknown"}`);
  }

  return json as T;
}
