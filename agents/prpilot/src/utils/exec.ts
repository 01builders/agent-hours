import { spawn } from "node:child_process";
import { logger } from "./logger.js";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function execCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    logger.debug("exec start", {
      command,
      args: args.join(" "),
      cwd: options.cwd ?? process.cwd(),
      timeoutMs: options.timeoutMs ?? 0,
    });

    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timeout: NodeJS.Timeout | undefined;

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString("utf8");
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf8");
    });

    proc.on("error", (error) => {
      logger.error("exec process error", { command, error: error.message });
      reject(error);
    });

    proc.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      const resultCode = code ?? 1;
      logger.debug("exec complete", {
        command,
        code: resultCode,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      });
      resolve({ code: resultCode, stdout, stderr });
    });

    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        logger.warn("exec timeout reached; sending SIGTERM", { command, timeoutMs: options.timeoutMs });
        proc.kill("SIGTERM");
      }, options.timeoutMs);
    }
  });
}

export function assertSuccess(result: ExecResult, context: string): void {
  if (result.code !== 0) {
    throw new Error(`${context} failed (${result.code}): ${result.stderr || result.stdout}`);
  }
}
