import fs from "node:fs/promises";
import express from "express";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { logger } from "./utils/logger.js";
import { metricsContentType, renderMetrics } from "./metrics/registry.js";
import { registerHealthRoutes } from "./web/health.js";

const cfg = loadConfig();
logger.setLevel(cfg.logLevel);
const { app, telegram } = createApp(cfg);

async function bootstrap(): Promise<void> {
  logger.debug("bootstrap start", {
    reposRoot: cfg.reposRoot,
    repoOwner: cfg.repoOwner,
    repoNames: cfg.repoNames.join(","),
    sessionDir: cfg.sessionDir,
  });

  await fs.mkdir(cfg.sessionDir, { recursive: true });

  const webhookUrl = `${cfg.publicBaseUrl.replace(/\/$/, "")}/telegram/webhook/${cfg.telegramWebhookSecret}`;
  const safeWebhookUrl = `${cfg.publicBaseUrl.replace(/\/$/, "")}/telegram/webhook/<redacted>`;

  for (const scope of [
    { type: "default" },
    { type: "all_private_chats" },
    { type: "all_group_chats" },
    { type: "all_chat_administrators" },
  ]) {
    await telegram.deleteMyCommands(scope).catch(() => {});
  }

  const repoNamesLabel = cfg.repoNames.join(", ");
  const repoCommandDescription = truncateForTelegramCommand(`Select repository (${repoNamesLabel})`);

  await telegram.setMyCommands([
    { command: "repo", description: repoCommandDescription },
    { command: "status", description: "Show bot health, branch, and current task" },
    { command: "tasks", description: "Show recent tasks and summaries" },
    { command: "apply", description: "Apply changes and open a PR (or /apply <task>)" },
    { command: "abort", description: "Abort the current running task" },
  ]);

  await telegram.setWebhook(webhookUrl, cfg.telegramWebhookSecret);
  const info = await telegram.getWebhookInfo();

  logger.info("telegram webhook configured", {
    webhookUrl: safeWebhookUrl,
    hasLastErrorDate: Boolean((info as any)?.last_error_date),
    pendingUpdateCount: (info as any)?.pending_update_count ?? 0,
  });

  app.listen(cfg.port, () => {
    logger.info("agent listening", { port: cfg.port });
  });

  const metricsApp = express();
  registerHealthRoutes(metricsApp);
  metricsApp.get("/metrics", async (_req, res) => {
    res.type(metricsContentType);
    res.send(await renderMetrics());
  });

  metricsApp.listen(cfg.metricsPort, () => {
    logger.info("metrics listening", { port: cfg.metricsPort });
  });
}

bootstrap().catch((error) => {
  logger.error("fatal startup error", { error: (error as Error).message });
  process.exit(1);
});

function truncateForTelegramCommand(input: string): string {
  if (input.length <= 256) return input;
  return `${input.slice(0, 253)}...`;
}
