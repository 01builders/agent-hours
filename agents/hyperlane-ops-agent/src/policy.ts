import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { looksLikeWriteToSensitiveFile, normalizeCommand, splitCommandSegments } from "./command-parser.js";
import { normalizeCoreCommandConfig, parseCoreCommand } from "./core-config.js";
import type { PolicyEvaluation } from "./types.js";

const DESTRUCTIVE_PATTERNS = [/\bgit\s+reset\s+--hard\b/i, /\bgit\s+checkout\s+--\b/i, /\brm\s+-rf\b/i];

const READ_PATTERNS: RegExp[] = [
  /^hyperlane\s+core\s+read\b/i,
  /^hyperlane\s+warp\s+read\b/i,
  /^hyperlane\s+registry\s+list\b/i,
  /^cast\s+call\b/i,
  /^celestia-appd\s+query\b/i,
  /^docker\s+compose\s+ps\b/i,
  /^docker\s+logs\b/i,
];

const WRITE_PATTERNS: RegExp[] = [
  /^hyperlane\s+core\s+(deploy|apply)\b/i,
  /^hyperlane\s+warp\s+(deploy|apply)\b/i,
  /^cast\s+send\b/i,
  /^celestia-appd\s+tx\b/i,
  /^docker\s+compose\s+(restart|up|down)\b/i,
];

function getFlagValue(command: string, ...flags: string[]): string | undefined {
  const tokens = command.split(/\s+/);
  for (let i = 0; i < tokens.length; i += 1) {
    if (flags.includes(tokens[i]) && tokens[i + 1]) {
      return tokens[i + 1];
    }
  }
  return undefined;
}

function requiresRegistry(command: string): boolean {
  return /^hyperlane\s+(core|warp)\s+/i.test(command);
}

function hasRegistryFlag(command: string): boolean {
  return /--registry\s+\./.test(command);
}

function configImpliesCosmosNative(command: string, cwd: string): boolean {
  const cfgPath =
    getFlagValue(command, "--config") ?? getFlagValue(command, "--wd") ?? getFlagValue(command, "--wc");
  if (!cfgPath) {
    return false;
  }

  try {
    const resolved = resolve(cwd, cfgPath);
    const contents = readFileSync(resolved, "utf8").toLowerCase();
    return contents.includes("celestia") || contents.includes("cosmosnative");
  } catch {
    return false;
  }
}

function commandTargetsCosmosNative(command: string, cwd: string): boolean {
  const lower = command.toLowerCase();

  if (lower.includes("celestia") || lower.includes("mocha") || lower.includes("cosmosnative")) {
    return true;
  }

  return configImpliesCosmosNative(command, cwd);
}

function getCoreCommandChain(command: string): string | undefined {
  return parseCoreCommand(command)?.chain;
}

function chainMetadataExists(cwd: string, chain: string): boolean {
  const metadataPath = resolve(cwd, "chains", chain, "metadata.yaml");
  try {
    readFileSync(metadataPath, "utf8");
    return true;
  } catch {
    return false;
  }
}

function hasEnv(name: string): boolean {
  return Boolean(process.env[name] && process.env[name]?.trim().length);
}

export function evaluateCommand(command: string, cwd: string): PolicyEvaluation {
  const normalizedCommand = normalizeCoreCommandConfig(normalizeCommand(command)).command;
  const normalized = normalizedCommand;

  if (!normalized) {
    return {
      class: "blocked",
      reason: "Empty command",
      requiresApproval: false,
    };
  }

  if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      class: "blocked",
      reason: "Destructive command class is blocked",
      remediation: "Use targeted non-destructive commands instead",
      requiresApproval: false,
    };
  }

  if (looksLikeWriteToSensitiveFile(normalized)) {
    return {
      class: "blocked",
      reason: "Writes to sensitive files are blocked",
      remediation: "Store secrets in environment variables and never write .env via the agent",
      requiresApproval: false,
    };
  }

  if (requiresRegistry(normalized) && !hasRegistryFlag(normalized)) {
    return {
      class: "blocked",
      reason: "Hyperlane commands must include --registry .",
      remediation: `${normalized} --registry .`,
      requiresApproval: false,
    };
  }

  const coreChain = getCoreCommandChain(normalized);
  const coreDetails = parseCoreCommand(normalized);
  if (coreDetails && (coreDetails.action === "deploy" || coreDetails.action === "apply")) {
    if (!coreChain) {
      return {
        class: "blocked",
        reason: "hyperlane core deploy/apply commands must include --chain",
        remediation: `${normalized} --chain <chain-name>`,
        requiresApproval: false,
      };
    }

    if (!coreDetails.configPath) {
      return {
        class: "blocked",
        reason: "hyperlane core deploy/apply commands must include --config configs/<chain>-core.yaml",
        remediation: `${normalized} --config configs/${coreChain}-core.yaml`,
        requiresApproval: false,
      };
    }

    if (coreDetails.configPath.replace(/^\.\//, "").endsWith("core-config.example.yaml")) {
      return {
        class: "blocked",
        reason: "Do not deploy directly with configs/core-config.example.yaml",
        remediation: `Use --config configs/${coreChain}-core.yaml (copied from configs/core-config.example.yaml)`,
        requiresApproval: false,
      };
    }
  }

  if (coreChain && /^hyperlane\s+core\s+(deploy|apply)\b/i.test(normalized) && !chainMetadataExists(cwd, coreChain)) {
    return {
      class: "blocked",
      reason: `Chain metadata is missing for '${coreChain}'`,
      remediation: `Create chains/${coreChain}/metadata.yaml first (for example: ops-agent add-chain --cwd ${cwd})`,
      requiresApproval: false,
    };
  }

  if (READ_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      class: "read",
      reason: "Read-only command is auto-allowed",
      requiresApproval: false,
    };
  }

  if (WRITE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    const isCosmos = commandTargetsCosmosNative(normalized, cwd);
    const isEvmWrite = /^cast\s+send\b/i.test(normalized) || /^hyperlane\s+/i.test(normalized);

    if (isEvmWrite && !hasEnv("HYP_KEY")) {
      return {
        class: "blocked",
        reason: "Missing required env var HYP_KEY for EVM mutating command",
        remediation: "export HYP_KEY=0x...",
        requiresApproval: false,
      };
    }

    if (isCosmos && !hasEnv("HYP_KEY_COSMOSNATIVE")) {
      return {
        class: "blocked",
        reason: "Missing required env var HYP_KEY_COSMOSNATIVE for cosmosnative mutating command",
        remediation: "export HYP_KEY_COSMOSNATIVE=0x...",
        requiresApproval: false,
      };
    }

    return {
      class: "write",
      reason: "Mutating command requires explicit approval",
      requiresApproval: true,
    };
  }

  return {
    class: "blocked",
    reason: "Command is outside the v1 allowlist",
    remediation: "Use supported core/warp/relayer workflows or run manually",
    requiresApproval: false,
  };
}

export function evaluatePipeline(command: string, cwd: string): PolicyEvaluation {
  const segments = splitCommandSegments(command);
  if (!segments.length) {
    return evaluateCommand(command, cwd);
  }

  let hasWrite = false;

  for (const segment of segments) {
    const evaluation = evaluateCommand(segment, cwd);
    if (evaluation.class === "blocked") {
      return evaluation;
    }
    if (evaluation.class === "write") {
      hasWrite = true;
    }
  }

  if (hasWrite) {
    return {
      class: "write",
      reason: "Pipeline includes mutating command(s), approval required",
      requiresApproval: true,
    };
  }

  return {
    class: "read",
    reason: "Pipeline is read-only",
    requiresApproval: false,
  };
}
