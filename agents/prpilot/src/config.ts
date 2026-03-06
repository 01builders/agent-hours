import { z } from "zod";
import type { AppConfig } from "./types.js";

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  METRICS_PORT: z.coerce.number().default(9090),
  PUBLIC_BASE_URL: z.string().url(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(8),
  TELEGRAM_ALLOWED_USER_ID: z.coerce.number().int(),
  LOG_LEVEL: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).default("INFO"),
  REPO_OWNER: z.string().min(1),
  REPOS_ROOT: z.string().min(1),
  REPO_NAMES: z.string().min(1),
  REPO_BASE_BRANCH: z.literal("main").default("main"),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_PEM: z.string().optional(),
  GITHUB_APP_INSTALLATION_ID: z.string().optional(),
  SESSION_DIR: z.string().default("/data/sessions"),
  NODE_ENV: z.enum(["development", "production", "test"]).optional(),
});

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }

  const cfg = parsed.data;
  if (!cfg.GITHUB_APP_PRIVATE_KEY_PATH && !cfg.GITHUB_APP_PRIVATE_KEY_PEM) {
    throw new Error("Either GITHUB_APP_PRIVATE_KEY_PATH or GITHUB_APP_PRIVATE_KEY_PEM must be set");
  }

  return {
    port: cfg.PORT,
    metricsPort: cfg.METRICS_PORT,
    publicBaseUrl: cfg.PUBLIC_BASE_URL,
    telegramBotToken: cfg.TELEGRAM_BOT_TOKEN,
    telegramWebhookSecret: cfg.TELEGRAM_WEBHOOK_SECRET,
    telegramAllowedUserId: cfg.TELEGRAM_ALLOWED_USER_ID,
    logLevel: cfg.LOG_LEVEL,
    repoOwner: cfg.REPO_OWNER,
    reposRoot: cfg.REPOS_ROOT,
    repoNames: parseRepoNames(cfg.REPO_NAMES),
    repoBaseBranch: cfg.REPO_BASE_BRANCH,
    githubAppId: cfg.GITHUB_APP_ID,
    githubAppPrivateKeyPath: cfg.GITHUB_APP_PRIVATE_KEY_PATH,
    githubAppPrivateKeyPem: cfg.GITHUB_APP_PRIVATE_KEY_PEM,
    githubAppInstallationId: cfg.GITHUB_APP_INSTALLATION_ID,
    sessionDir: cfg.SESSION_DIR,
    isDev: cfg.NODE_ENV === "development",
  };
}

function parseRepoNames(input: string): string[] {
  const names = input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!names.length) {
    throw new Error("REPO_NAMES must include at least one repository name");
  }

  const unique = [...new Set(names)];
  if (unique.length !== names.length) {
    throw new Error("REPO_NAMES must not contain duplicates");
  }

  return unique;
}
