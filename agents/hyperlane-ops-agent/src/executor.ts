import { spawn } from "node:child_process";

export interface CommandExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function executeShellCommand(command: string, cwd: string): Promise<CommandExecutionResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/zsh", ["-lc", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}
