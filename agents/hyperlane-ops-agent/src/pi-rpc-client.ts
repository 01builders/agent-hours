import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { fileURLToPath } from "node:url";

interface RpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface PendingRequest {
  resolve: (value: RpcResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface ExtensionUiRequest {
  type: "extension_ui_request";
  id?: string;
  method?: string;
}

export interface PiRpcEvent {
  type: string;
  [key: string]: unknown;
}

export interface PiRpcOptions {
  cwd: string;
  provider?: string;
  model?: string;
  sessionDir?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function projectRootFromRuntime(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function resolvePiExecutable(cwd: string): string {
  if (process.env.PI_BIN && process.env.PI_BIN.trim().length > 0) {
    return process.env.PI_BIN.trim();
  }

  const isWin = process.platform === "win32";
  const binaryName = isWin ? "pi.cmd" : "pi";
  const projectRoot = projectRootFromRuntime();

  const candidates = [
    resolve(cwd, "node_modules/.bin", binaryName),
    resolve(projectRoot, "node_modules/.bin", binaryName),
  ];

  const match = candidates.find((candidate) => existsSync(candidate));
  if (match) {
    return match;
  }

  return binaryName;
}

function enrichSpawnError(error: Error, command: string): Error {
  const asErrno = error as NodeJS.ErrnoException;
  if (asErrno.code !== "ENOENT") {
    return error;
  }

  return new Error(
    `Failed to launch Pi RPC binary '${command}' (ENOENT). Install dependencies in ops-agent (npm install), or set PI_BIN to a valid pi executable path.`,
  );
}

export class PiRpcClient {
  private process: ChildProcess | null = null;
  private rl: Interface | null = null;
  private stderr = "";
  private requestId = 0;
  private pending = new Map<string, PendingRequest>();
  private eventListeners = new Set<(event: PiRpcEvent) => void>();

  constructor(private readonly options: PiRpcOptions) {}

  async start(): Promise<void> {
    if (this.process) {
      throw new Error("Pi RPC client already started");
    }

    const args = ["--mode", "rpc", "--no-session"];

    if (this.options.provider) {
      args.push("--provider", this.options.provider);
    }
    if (this.options.model) {
      args.push("--model", this.options.model);
    }
    if (this.options.sessionDir) {
      args.push("--session-dir", this.options.sessionDir);
    }

    const command = resolvePiExecutable(this.options.cwd);

    this.process = spawn(command, args, {
      cwd: this.options.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let startupError: Error | null = null;

    this.process.on("error", (error) => {
      startupError = enrichSpawnError(error, command);

      for (const req of this.pending.values()) {
        clearTimeout(req.timeout);
        req.reject(startupError);
      }
      this.pending.clear();
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error("Pi RPC failed to start with piped stdio");
    }

    this.process.stderr?.on("data", (chunk) => {
      this.stderr += chunk.toString();
    });

    this.rl = createInterface({
      input: this.process.stdout,
      terminal: false,
    });

    this.rl.on("line", (line) => {
      this.onLine(line);
    });

    this.process.on("exit", (code) => {
      const error = new Error(`Pi RPC exited with code ${code}. Stderr: ${this.stderr}`);
      for (const req of this.pending.values()) {
        clearTimeout(req.timeout);
        req.reject(error);
      }
      this.pending.clear();
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    if (startupError) {
      throw startupError;
    }

    if (this.process.exitCode !== null) {
      throw new Error(`Pi RPC exited immediately with code ${this.process.exitCode}. Stderr: ${this.stderr}`);
    }
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    this.rl?.close();
    this.process.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.process?.kill("SIGKILL");
        resolve();
      }, 1000);

      this.process?.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.process = null;
    this.rl = null;
    this.stderr = "";
  }

  onEvent(listener: (event: PiRpcEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  async prompt(message: string): Promise<void> {
    await this.send({ type: "prompt", message });
  }

  async getLastAssistantText(): Promise<string | null> {
    const response = await this.send({ type: "get_last_assistant_text" });
    return (response.data as { text: string | null } | undefined)?.text ?? null;
  }

  async collectEventsUntilIdle(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<PiRpcEvent[]> {
    return new Promise((resolve, reject) => {
      const events: PiRpcEvent[] = [];
      const recentTypes: string[] = [];
      const timer = setTimeout(() => {
        unsubscribe();
        const suffix = recentTypes.length > 0 ? ` Recent events: ${recentTypes.join(", ")}` : "";
        reject(new Error(`Timed out waiting for agent_end. Stderr: ${this.stderr}${suffix}`));
      }, timeoutMs);

      const unsubscribe = this.onEvent((event) => {
        events.push(event);
        const eventType = typeof event.type === "string" ? event.type : "unknown";
        recentTypes.push(eventType);
        if (recentTypes.length > 12) {
          recentTypes.shift();
        }
        if (event.type === "agent_end") {
          clearTimeout(timer);
          unsubscribe();
          resolve(events);
        }
      });
    });
  }

  async promptAndWait(message: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<PiRpcEvent[]> {
    const eventsPromise = this.collectEventsUntilIdle(timeoutMs);
    await this.prompt(message);
    return eventsPromise;
  }

  private onLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    const asRecord = parsed as Record<string, unknown>;
    if (asRecord.type === "response") {
      const id = asRecord.id as string | undefined;
      if (id && this.pending.has(id)) {
        const pending = this.pending.get(id)!;
        this.pending.delete(id);
        clearTimeout(pending.timeout);

        const response = parsed as RpcResponse;
        if (response.success) {
          pending.resolve(response);
        } else {
          pending.reject(new Error(response.error ?? "Unknown RPC error"));
        }
      }
      return;
    }

    if (asRecord.type === "extension_ui_request") {
      this.respondToExtensionUiRequest(parsed as ExtensionUiRequest);
    }

    const event = parsed as PiRpcEvent;
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private respondToExtensionUiRequest(request: ExtensionUiRequest): void {
    const requestId = request.id;
    if (!requestId || !this.process?.stdin) {
      return;
    }

    // ops-agent is a headless runtime, so extension UI prompts must be cancelled.
    const response = {
      type: "extension_ui_response",
      id: requestId,
      cancelled: true,
    };
    this.process.stdin.write(`${JSON.stringify(response)}\n`);
  }

  private async send(command: Record<string, unknown>): Promise<RpcResponse> {
    if (!this.process?.stdin) {
      throw new Error("Pi RPC client is not started");
    }

    const id = `req_${++this.requestId}`;
    const payload = { ...command, id };

    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const responsePromise = new Promise<RpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC command timed out: ${String(command.type)}. Stderr: ${this.stderr}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve,
        reject,
        timeout,
      });
    });

    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
    return responsePromise;
  }
}
