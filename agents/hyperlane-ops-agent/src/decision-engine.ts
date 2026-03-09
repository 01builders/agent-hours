import { existsSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { normalizeCoreCommandConfig } from "./core-config.js";
import type { DecisionEngine, DecisionPlan } from "./types.js";
import { PiRpcClient } from "./pi-rpc-client.js";

interface RawPlan {
  summary: string;
  commands: string[];
}

function extractJsonPayload(text: string): RawPlan {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  const payload = fenced ? fenced[1] : trimmed;

  const parsed = JSON.parse(payload) as RawPlan;

  if (!parsed.summary || !Array.isArray(parsed.commands)) {
    throw new Error("Plan output missing summary or commands");
  }

  if (!parsed.commands.every((item) => typeof item === "string")) {
    throw new Error("Plan commands must be strings");
  }

  return parsed;
}

function resolvePiRuntimeCwd(commandCwd: string): string {
  if (process.env.PI_PROJECT_CWD && process.env.PI_PROJECT_CWD.trim().length > 0) {
    return resolve(process.env.PI_PROJECT_CWD.trim());
  }

  const candidates = [commandCwd, resolve(commandCwd, ".."), resolve(commandCwd, "ops-agent")];
  const visited = new Set<string>();
  for (const candidate of candidates) {
    const normalized = resolve(candidate);
    if (visited.has(normalized)) {
      continue;
    }
    visited.add(normalized);
    if (existsSync(resolve(normalized, ".pi/settings.json"))) {
      return normalized;
    }
  }

  return commandCwd;
}

function makePlannerPrompt(goal: string, commandCwd: string, context?: string): string {
  const contextText = context?.trim().length ? `Context:\n${context}\n` : "";

  return [
    "You are an ops command planner for a Hyperlane operations repository.",
    "Create a concise execution plan as strict JSON with this shape:",
    '{"summary":"...","commands":["..."]}',
    "Rules:",
    "- Commands must be shell commands only.",
    "- Prefer read-only checks first, then mutating commands if needed.",
    "- Use --registry . for hyperlane core/warp commands.",
    "- For hyperlane core deploy/apply/read commands, always include --chain and --config configs/<chain>-core.yaml.",
    "- Never use configs/core-config.example.yaml directly in hyperlane core deploy/apply/read commands.",
    "- Before core deploy/apply on a chain, ensure chains/<chain>/metadata.yaml exists; if missing, do not include deploy/apply.",
    "- Use only these workflow families: hyperlane core, hyperlane warp, docker compose relayer, cast call/send, celestia-appd query/tx.",
    `- Commands are executed from this working directory: ${commandCwd}`,
    "- No prose outside JSON.",
    contextText,
    `Goal: ${goal}`,
  ].join("\n");
}

function extractCoreCommandChain(command: string): string | null {
  const coreCommand = command.match(/^hyperlane\s+core\s+(read|deploy|apply)\b/i);
  if (!coreCommand) {
    return null;
  }

  const match = command.match(/(?:^|\s)--chain\s+([^\s]+)/i);
  return match?.[1] ?? null;
}

function isCoreMutatingCommand(command: string): boolean {
  return /^hyperlane\s+core\s+(deploy|apply)\b/i.test(command);
}

function hasChainMetadata(cwd: string, chain: string): boolean {
  return existsSync(resolve(cwd, "chains", chain, "metadata.yaml"));
}

function enforceCoreConfigDefaults(plan: DecisionPlan): DecisionPlan {
  let changed = false;
  const commands = plan.commands.map((command) => {
    const next = normalizeCoreCommandConfig(command);
    if (next.changed) {
      changed = true;
    }
    return next.command;
  });

  if (!changed) {
    return plan;
  }

  const note =
    "Core config default applied: using --config configs/<chain>-core.yaml for hyperlane core commands.";
  return {
    ...plan,
    summary: `${note} ${plan.summary}`,
    commands,
    rawResponse: plan.rawResponse ? `${plan.rawResponse}\nPlanner guard: ${note}` : `Planner guard: ${note}`,
  };
}

function enforceChainMetadataPrerequisites(plan: DecisionPlan, cwd: string): DecisionPlan {
  const missingChains = new Set<string>();

  for (const command of plan.commands) {
    if (!isCoreMutatingCommand(command)) {
      continue;
    }
    const chain = extractCoreCommandChain(command);
    if (!chain) {
      continue;
    }
    if (!hasChainMetadata(cwd, chain)) {
      missingChains.add(chain);
    }
  }

  if (missingChains.size === 0) {
    return plan;
  }

  const filteredCommands = plan.commands.filter((command) => {
    const chain = extractCoreCommandChain(command);
    if (!chain) {
      return true;
    }
    return !missingChains.has(chain);
  });

  const commands = filteredCommands.length > 0 ? filteredCommands : ["hyperlane registry list --registry ."];
  const missing = [...missingChains].sort().join(", ");
  const prerequisiteNote = `Prerequisite required: add chain metadata first for [${missing}] under chains/<chain>/metadata.yaml (for example: ops-agent add-chain --cwd ${cwd}).`;
  const summary = `${prerequisiteNote} ${plan.summary}`;
  const rawResponse = plan.rawResponse
    ? `${plan.rawResponse}\nPlanner guard: ${prerequisiteNote}`
    : `Planner guard: ${prerequisiteNote}`;

  return {
    ...plan,
    summary,
    commands,
    rawResponse,
  };
}

function listLocalChains(cwd: string): string[] {
  const chainsDir = resolve(cwd, "chains");
  if (!existsSync(chainsDir)) {
    return [];
  }

  try {
    return readdirSync(chainsDir)
      .filter((entry) => {
        const chainDir = join(chainsDir, entry);
        return statSync(chainDir).isDirectory() && existsSync(join(chainDir, "metadata.yaml"));
      })
      .map((entry) => entry.toLowerCase());
  } catch {
    return [];
  }
}

function extractRequestedChain(goal: string, context: string | undefined, cwd: string): string | undefined {
  const haystack = `${goal}\n${context ?? ""}`.toLowerCase();
  const knownChains = listLocalChains(cwd);

  for (const chain of knownChains) {
    const pattern = new RegExp(`(?:^|[^a-z0-9_-])${chain}(?:[^a-z0-9_-]|$)`, "i");
    if (pattern.test(haystack)) {
      return chain;
    }
  }

  const explicitMatch = haystack.match(
    /\b(?:chain(?:\s+called|\s+named)?|for\s+chain|on\s+chain)\s+([a-z][a-z0-9_-]*)\b/i,
  );
  if (explicitMatch?.[1]) {
    return explicitMatch[1].toLowerCase();
  }

  return undefined;
}

export class PiDecisionEngine implements DecisionEngine {
  async createPlan(goal: string, context: string | undefined, cwd: string): Promise<DecisionPlan> {
    const piRuntimeCwd = resolvePiRuntimeCwd(cwd);
    const client = new PiRpcClient({
      cwd: piRuntimeCwd,
      provider: process.env.PI_DEFAULT_PROVIDER,
      model: process.env.PI_DEFAULT_MODEL,
      sessionDir: process.env.PI_SESSION_DIR,
      timeoutMs: Number(process.env.PI_RPC_TIMEOUT_MS ?? 120_000),
    });

    try {
      await client.start();
      const prompt = makePlannerPrompt(goal, cwd, context);
      let waitError: Error | undefined;
      try {
        await client.promptAndWait(prompt);
      } catch (error) {
        waitError = error instanceof Error ? error : new Error(String(error));
      }
      const assistantText = await client.getLastAssistantText();
      if (!assistantText) {
        if (waitError) {
          throw waitError;
        }
        throw new Error("Pi returned no assistant message");
      }
      const parsed = extractJsonPayload(assistantText);
      const normalized = enforceCoreConfigDefaults({
        summary: parsed.summary,
        commands: parsed.commands,
        rawResponse: assistantText,
      });
      const guarded = enforceChainMetadataPrerequisites(normalized, cwd);

      return {
        summary: guarded.summary,
        commands: guarded.commands,
        rawResponse: guarded.rawResponse,
      };
    } finally {
      await client.stop();
    }
  }
}

export class FallbackDecisionEngine implements DecisionEngine {
  async createPlan(goal: string, context: string | undefined, cwd: string): Promise<DecisionPlan> {
    const lower = goal.toLowerCase();
    const commands: string[] = [];
    const inferredChain = extractRequestedChain(goal, context, cwd);

    if (lower.includes("relayer") || lower.includes("health")) {
      commands.push("docker compose ps relayer");
      commands.push("docker logs hyperlane-relayer --tail=200");
    }

    if (lower.includes("warp")) {
      commands.push("hyperlane warp read --symbol USDC --registry .");
    }

    if (lower.includes("core")) {
      if (inferredChain) {
        commands.push(`hyperlane core read --chain ${inferredChain} --config configs/${inferredChain}-core.yaml --registry .`);
      } else {
        commands.push("hyperlane registry list --registry .");
      }
    }

    if (!commands.length) {
      commands.push("docker compose ps relayer");
      commands.push("hyperlane registry list --registry .");
    }

    return enforceCoreConfigDefaults({
      summary: "Fallback command plan based on repository runbooks",
      commands,
    });
  }
}
