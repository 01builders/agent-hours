import fs from "node:fs/promises";
import path from "node:path";
import type { RunMode } from "../types.js";
import { recordPiAgentsMdLoadFailure, recordPiRun, type PiRunResult } from "../metrics/pi-agent-metrics.js";
import { logger } from "../utils/logger.js";
import { PiSessionManager } from "./session-manager.js";
import { buildTelegramAgentPrompt } from "./telegram-prompt-policy.js";

export class PiRunner {
  constructor(private readonly sessions: PiSessionManager) {}

  async run(
    chatId: number,
    mode: RunMode,
    task: string,
    repoName: string,
    repoPath: string,
  ): Promise<string> {
    const writable = mode === "apply";
    const startedAtNs = process.hrtime.bigint();
    let result: PiRunResult = "error";
    let entry: Awaited<ReturnType<PiSessionManager["getSession"]>> | null = null;

    logger.debug("pi run start", { chatId, mode, writable, repoName });

    try {
      entry = await this.sessions.getSession(chatId, writable, repoName, repoPath);

      if (entry.busy) {
        result = "busy";
        logger.debug("pi session busy", { chatId, mode });
        throw new Error("Session is busy. Use /abort or wait for completion.");
      }

      entry.busy = true;
      const prompt = await this.buildPrompt(mode, task, repoName, repoPath);
      logger.debug("pi prompt dispatch", { chatId, mode, promptLength: prompt.length });
      await entry.session.prompt(prompt);
      const output = entry.session.getLastAssistantText();
      if (!output) {
        result = "empty-output";
        const msgCount = entry.session.messages.length;
        const roles = entry.session.messages.map((m: any) => m.role ?? m.type ?? "unknown").join(",");
        logger.warn("pi run: no assistant text found", { chatId, mode, msgCount, roles });
        return "Task completed, but no assistant response was produced. Please try again or rephrase your request.";
      }

      result = "success";
      logger.debug("pi run complete", { chatId, mode, outputLength: output.length });
      return output;
    } catch (error) {
      if (result !== "busy") {
        result = isAbortError(error) ? "aborted" : "error";
      }
      throw error;
    } finally {
      if (entry?.busy) {
        entry.busy = false;
      }
      const durationSeconds = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000_000;
      recordPiRun(mode, result, durationSeconds);
    }
  }

  async getLastChatSummary(chatId: number, repoName: string, repoPath: string): Promise<string | null> {
    const entry = await this.sessions.getSession(chatId, false, repoName, repoPath);
    if (!entry.session.messages.length) return null;
    return entry.session.getLastAssistantText() ?? null;
  }

  private async buildPrompt(
    mode: RunMode,
    task: string,
    repoName: string,
    repoPath: string,
  ): Promise<string> {
    const agentsInstructions = await this.loadAgentsInstructions(repoPath);

    if (mode === "chat") {
      return buildTelegramAgentPrompt({
        repoName,
        agentsInstructions,
        taskLabel: "User message from Telegram:",
        task,
        responseInstruction: "Respond for Telegram. Keep it concise and actionable.",
      });
    }

    return buildTelegramAgentPrompt({
      repoName,
      agentsInstructions,
      taskLabel: "Apply-mode task:",
      task,
      responseInstruction: "Execute the task directly in the repository and summarize results for Telegram.",
    });
  }

  private async loadAgentsInstructions(repoPath: string): Promise<string> {
    const agentsPath = path.join(repoPath, "AGENTS.md");
    try {
      const content = await fs.readFile(agentsPath, "utf8");
      const trimmed = content.trim();
      if (!trimmed) {
        throw new Error("AGENTS.md is empty");
      }
      return trimmed;
    } catch (error) {
      recordPiAgentsMdLoadFailure();
      logger.error("failed to load AGENTS.md for repository prompt construction", {
        repoPath,
        agentsPath,
        error: (error as Error).message,
      });
      throw new Error(`AGENTS.md is required at repository root: ${agentsPath}`);
    }
  }
}

function isAbortError(error: unknown): boolean {
  const message = (error as Error)?.message ?? "";
  return /abort/i.test(message);
}
