import fs from "node:fs/promises";
import path from "node:path";
import {
  createAgentSession,
  createCodingTools,
  createReadOnlyTools,
  SessionManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import { createWebTool } from "./web-tool.js";
import {
  recordPiSessionAbort,
  recordPiSessionGet,
  recordPiSessionIndexIoError,
  setPiSessionsActive,
} from "../metrics/pi-agent-metrics.js";
import type { AppConfig } from "../types.js";
import { logger } from "../utils/logger.js";

interface SessionEntry {
  session: AgentSession;
  busy: boolean;
}

export class PiSessionManager {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly indexPath: string;

  constructor(private readonly cfg: AppConfig) {
    this.indexPath = path.join(cfg.sessionDir, "session-index.json");
    setPiSessionsActive(0);
  }

  async getSession(chatId: number, writable: boolean, repoName: string, repoPath: string): Promise<SessionEntry> {
    const key = `${chatId}:${writable ? "rw" : "ro"}:${repoName}`;
    const existing = this.sessions.get(key);
    if (existing) {
      recordPiSessionGet(writable ? "rw" : "ro", "hit");
      logger.debug("session cache hit", { key });
      return existing;
    }

    recordPiSessionGet(writable ? "rw" : "ro", "miss");
    logger.debug("session cache miss", { key });

    const tools = writable
      ? createCodingTools(repoPath)
      : [...createReadOnlyTools(repoPath), createWebTool(repoPath)];
    const index = await this.readIndex();
    const existingFile = index[key];
    logger.debug("session resolving", {
      key,
      mode: writable ? "rw" : "ro",
      repoName,
      existingFile: existingFile ?? "none",
    });

    const { session } = await createAgentSession({
      cwd: repoPath,
      tools,
      sessionManager: existingFile ? SessionManager.open(existingFile) : SessionManager.create(repoPath, this.cfg.sessionDir),
    });

    if (!existingFile && session.sessionFile) {
      index[key] = session.sessionFile;
      await this.writeIndex(index);
      logger.debug("session index updated", { key, sessionFile: session.sessionFile });
    }

    const entry: SessionEntry = { session, busy: false };
    this.sessions.set(key, entry);
    setPiSessionsActive(this.sessions.size);
    return entry;
  }

  async abort(chatId: number): Promise<boolean> {
    let aborted = false;
    for (const [key, entry] of this.sessions.entries()) {
      if (!key.startsWith(`${chatId}:`)) continue;
      if (entry.session.isStreaming) {
        logger.debug("aborting streaming session", { key });
        await entry.session.abort();
        aborted = true;
      }
    }
    recordPiSessionAbort(aborted ? "aborted" : "no-active");
    logger.debug("abort result", { chatId, aborted });
    return aborted;
  }

  private async readIndex(): Promise<Record<string, string>> {
    try {
      const data = await fs.readFile(this.indexPath, "utf8");
      return JSON.parse(data) as Record<string, string>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        recordPiSessionIndexIoError("read");
      }
      return {};
    }
  }

  private async writeIndex(index: Record<string, string>): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
      await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2));
    } catch (error) {
      recordPiSessionIndexIoError("write");
      throw error;
    }
  }
}
