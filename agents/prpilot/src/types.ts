export type RunMode = "chat" | "apply";

import type { LogLevel } from "./utils/logger.js";

export interface RepoContext {
  repoName: string;
  repoOwner: string;
  repoPath: string;
  repoBaseBranch: "main";
}

export interface AppConfig {
  port: number;
  metricsPort: number;
  publicBaseUrl: string;
  telegramBotToken: string;
  telegramWebhookSecret: string;
  telegramAllowedUserId: number;
  logLevel: LogLevel;
  repoOwner: string;
  reposRoot: string;
  repoNames: string[];
  repoBaseBranch: "main";
  githubAppId: string;
  isDev: boolean;
  githubAppPrivateKeyPath?: string;
  githubAppPrivateKeyPem?: string;
  githubAppInstallationId?: string;
  sessionDir: string;
}

export interface CommandContext {
  chatId: number;
  userId: number;
  text: string;
}
