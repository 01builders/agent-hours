import { createBashTool } from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const ALLOWED_COMMANDS = ["lynx"];

/**
 * Creates a web browsing tool restricted to lynx.
 * Used in planning mode to give the agent internet access
 * without allowing arbitrary shell commands.
 */
export function createWebTool(cwd: string): AgentTool<any> {
  const tool = createBashTool(cwd, {
    spawnHook: (context) => {
      validateCommand(context.command);
      return context;
    },
  });

  return {
    ...tool,
    name: "web",
    label: "web",
    description: [
      "Browse the web using lynx. Use this to search the internet, read documentation, or fetch content from URLs.",
      "",
      "Examples:",
      '  lynx -dump "https://example.com"',
      '  lynx -dump "https://www.google.com/search?q=kubernetes+hpa+docs"',
      "",
      "Always use lynx with -dump for plain text output.",
      "Only lynx commands are allowed.",
    ].join("\n"),
  };
}

function validateCommand(command: string): void {
  // Strip leading whitespace and shell constructs to find the base command
  const normalized = command.replace(/^\s*(set\s[^;]*;\s*)*/, "").trim();

  // Check each piped/chained segment
  const segments = normalized.split(/[|;&]\s*/);
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const base = trimmed.split(/\s/)[0];
    if (!ALLOWED_COMMANDS.includes(base)) {
      throw new Error(`Command not allowed: ${base}. Only lynx is permitted in planning mode.`);
    }
  }
}
