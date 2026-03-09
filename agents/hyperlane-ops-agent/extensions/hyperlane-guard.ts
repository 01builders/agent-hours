import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function missingEnv(name: string): boolean {
  return !(process.env[name] && process.env[name]?.trim().length);
}

function getCommand(input: unknown): string {
  if (!input || typeof input !== "object") {
    return "";
  }
  const maybeCommand = (input as { command?: unknown }).command;
  return typeof maybeCommand === "string" ? maybeCommand : "";
}

export default function hyperlaneGuard(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") {
      return;
    }

    const command = getCommand(event.input).trim();
    const lower = command.toLowerCase();

    if (!command.length) {
      return;
    }

    if (/\bgit\s+reset\s+--hard\b/i.test(command) || /\bgit\s+checkout\s+--\b/i.test(command) || /\brm\s+-rf\b/i.test(command)) {
      return { block: true, reason: "Blocked destructive command class" };
    }

    if (lower.includes(".env")) {
      return { block: true, reason: "Blocked access to sensitive .env paths" };
    }

    if (/^hyperlane\s+(core|warp)\s+/i.test(command) && !/--registry\s+\./.test(command)) {
      return { block: true, reason: "Hyperlane commands must include --registry ." };
    }

    if (/^hyperlane\s+(core|warp)\s+(deploy|apply)\b/i.test(command) && missingEnv("HYP_KEY")) {
      return { block: true, reason: "Missing HYP_KEY for mutating Hyperlane command" };
    }

    if (
      (/^hyperlane\s+(core|warp)\s+(deploy|apply)\b/i.test(command) &&
        /(celestia|cosmosnative|mocha)/i.test(command) &&
        missingEnv("HYP_KEY_COSMOSNATIVE")) ||
      (/^celestia-appd\s+tx\b/i.test(command) && missingEnv("HYP_KEY_COSMOSNATIVE"))
    ) {
      return { block: true, reason: "Missing HYP_KEY_COSMOSNATIVE for cosmosnative mutation" };
    }

    if (/^cast\s+send\b/i.test(command) && missingEnv("HYP_KEY")) {
      return { block: true, reason: "Missing HYP_KEY for cast send command" };
    }

    if (/^docker\s+compose\s+(down|up|restart)\b/i.test(command)) {
      return {
        block: true,
        reason: "Compose mutating commands must be executed through ops-agent approval flow",
      };
    }
  });
}
