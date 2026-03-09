#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { startServer } from "./server.js";
import { PiRpcClient } from "./pi-rpc-client.js";

type Args = {
  _: string[];
  flags: Record<string, string | boolean | string[]>;
};

type InteractiveWorkflow = "add-chain" | "hyperlane-core" | "warp-route";

interface InteractiveWorkflowConfig {
  skillName: string;
  title: string;
  firstQuestion: string;
}

const INTERACTIVE_WORKFLOW_CONFIG: Record<InteractiveWorkflow, InteractiveWorkflowConfig> = {
  "add-chain": {
    skillName: "add-chain",
    title: "Add Chain",
    firstQuestion: "Start by asking which protocol the new chain uses: cosmosnative or ethereum.",
  },
  "hyperlane-core": {
    skillName: "hyperlane-core",
    title: "Hyperlane Core",
    firstQuestion:
      "Start by building a deployment plan first (before any mutating action), then ask which chain(s) this should target and whether the user wants deploy, apply, or read.",
  },
  "warp-route": {
    skillName: "warp-route",
    title: "Warp Route",
    firstQuestion:
      "Start by asking the route symbol and participating chains, then continue intake one question at a time.",
  },
};

const COMMAND_HELP: Record<string, string> = {
  serve: `Hyperlane Ops Agent - serve

Usage:
  ops-agent serve [--port 8787] [--cwd /path]

Options:
  --port <number>   Port to bind (default: 8787)
  --cwd <path>      Working directory for repository operations

Examples:
  ops-agent serve
  ops-agent serve --port 8787 --cwd /Users/damiannolan/development/hyperlane-ops`,
  plan: `Hyperlane Ops Agent - plan

Usage:
  ops-agent plan "<goal>" [--json] [--host http://127.0.0.1:8787]

Options:
  --json            Output JSON
  --host <url>      Ops-agent server URL

Examples:
  ops-agent plan "create deployment plan for hyperlane core on <chain-name>"
  ops-agent plan "check relayer health" --host http://127.0.0.1:8787`,
  info: `Hyperlane Ops Agent - info

Usage:
  ops-agent info [--verify] [--json] [--host http://127.0.0.1:8787]

Options:
  --verify          Perform runtime Pi verification call
  --json            Output raw JSON
  --host <url>      Ops-agent server URL

Examples:
  ops-agent info
  ops-agent info --verify
  ops-agent info --verify --json`,
  approve: `Hyperlane Ops Agent - approve

Usage:
  ops-agent approve <planId> --all [--ttl 900] [--host http://127.0.0.1:8787]
  ops-agent approve <planId> --hash <hash> [--hash <hash2>] [--ttl 900] [--host ...]

Options:
  --all             Approve all non-blocked commands in the plan
  --hash <hash>     Approve one specific command hash (repeatable)
  --ttl <seconds>   Approval token TTL in seconds (default: 900)
  --host <url>      Ops-agent server URL

Examples:
  ops-agent approve <planId> --all
  ops-agent approve <planId> --hash <hash> --ttl 1200`,
  execute: `Hyperlane Ops Agent - execute

Usage:
  ops-agent execute <planId> --token <approvalToken> [--host http://127.0.0.1:8787]

Options:
  --token <token>   Approval token from approve command
  --host <url>      Ops-agent server URL

Examples:
  ops-agent execute <planId> --token <approvalToken>`,
  run: `Hyperlane Ops Agent - run

Usage:
  ops-agent run "<goal>" --read-only [--host http://127.0.0.1:8787]

Options:
  --read-only       Required for safe diagnostic run mode
  --host <url>      Ops-agent server URL

Examples:
  ops-agent run "diagnose relayer lag" --read-only`,
  "add-chain": `Hyperlane Ops Agent - add-chain

Usage:
  ops-agent add-chain [--cwd /path]

Options:
  --cwd <path>      Repository working directory where chains/<name>/metadata.yaml will be written

Examples:
  ops-agent add-chain
  ops-agent add-chain --cwd /Users/damiannolan/development/hyperlane-ops`,
  "hyperlane-core": `Hyperlane Ops Agent - hyperlane-core

Usage:
  ops-agent hyperlane-core [--cwd /path]

Options:
  --cwd <path>      Repository working directory for workflow execution
  --provider <id>   Override PI provider for this session
  --model <id>      Override PI model for this session
  --timeout <ms>    Per-turn timeout in milliseconds

Examples:
  ops-agent hyperlane-core`,
  "warp-route": `Hyperlane Ops Agent - warp-route

Usage:
  ops-agent warp-route [--cwd /path]

Options:
  --cwd <path>      Repository working directory for workflow execution
  --provider <id>   Override PI provider for this session
  --model <id>      Override PI model for this session
  --timeout <ms>    Per-turn timeout in milliseconds

Examples:
  ops-agent warp-route`,
};

type InfoResponse = {
  model?: {
    provider?: string;
    model?: string;
  };
  credentials?: {
    openaiApiKeyPresent?: boolean;
    hypKeyPresent?: boolean;
    hypKeyCosmosnativePresent?: boolean;
    authFilePath?: string;
    authFilePresent?: boolean;
    authFileHasOpenAiApiKey?: boolean;
    authFileHasOpenAiCodexOAuth?: boolean;
    authFileParseError?: string;
  };
  runtime?: {
    cwd?: string;
    sessionDir?: string;
    skills?: string[];
  };
  verification?: {
    requested?: boolean;
    ok?: boolean;
    provider?: string;
    model?: string;
    error?: string;
  };
};

function parseArgs(argv: string[]): Args {
  const args: Args = { _: [], flags: {} };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "-h") {
      args.flags.help = true;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args.flags[key] = true;
      } else {
        const existing = args.flags[key];
        if (typeof existing === "string") {
          args.flags[key] = [existing, next];
        } else if (Array.isArray(existing)) {
          args.flags[key] = [...existing, next];
        } else {
          args.flags[key] = next;
        }
        i += 1;
      }
      continue;
    }

    args._.push(token);
  }

  return args;
}

function requireString(value: string | boolean | string[] | undefined, field: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new Error(`Missing required flag --${field}`);
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<unknown> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new Error(parsed.error ?? `Request failed (${response.status})`);
    }

    return parsed;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch failed")) {
      throw new Error(
        `Could not reach ops-agent at ${baseUrl}. Start the server first (for example: ops-agent serve), or pass --host <url>.`,
      );
    }
    throw error;
  }
}

async function getJson(baseUrl: string, path: string): Promise<unknown> {
  try {
    const response = await fetch(`${baseUrl}${path}`);
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new Error(parsed.error ?? `Request failed (${response.status})`);
    }

    return parsed;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch failed")) {
      throw new Error(
        `Could not reach ops-agent at ${baseUrl}. Start the server first (for example: ops-agent serve), or pass --host <url>.`,
      );
    }
    throw error;
  }
}

const WORKFLOW_COMPLETE_SENTINEL = "OPS_AGENT_WORKFLOW_COMPLETE";
const WORKFLOW_CANCELLED_SENTINEL = "OPS_AGENT_WORKFLOW_CANCELLED";

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

function resolveCommandCwd(parsed: Args): string {
  if (typeof parsed.flags.cwd === "string" && parsed.flags.cwd.trim().length > 0) {
    return resolve(parsed.flags.cwd);
  }

  if (process.env.OPS_AGENT_CWD && process.env.OPS_AGENT_CWD.trim().length > 0) {
    return resolve(process.env.OPS_AGENT_CWD.trim());
  }

  const cwd = process.cwd();
  if (existsSync(resolve(cwd, "chains"))) {
    return cwd;
  }

  const parent = resolve(cwd, "..");
  if (existsSync(resolve(parent, "chains"))) {
    return parent;
  }

  return cwd;
}

function buildInteractiveKickoffPrompt(workflow: InteractiveWorkflow, commandCwd: string): string {
  return buildInteractiveKickoffPromptWithIntake(workflow, commandCwd, []);
}

function buildInteractiveKickoffPromptWithIntake(
  workflow: InteractiveWorkflow,
  commandCwd: string,
  initialIntake: string[],
): string {
  const config = INTERACTIVE_WORKFLOW_CONFIG[workflow];
  const intakeSection =
    initialIntake.length > 0
      ? [`User already provided these initial values:`, ...initialIntake.map((item) => `- ${item}`)].join("\n")
      : "No initial values captured yet.";
  const workflowSpecific =
    workflow === "hyperlane-core"
      ? [
          "- For core deployment workflows, always produce a deployment plan first before proposing execution.",
          "- Core deploy/apply plan steps must use --config configs/<chain>-core.yaml.",
        ]
      : [];

  return [
    `You are running the Hyperlane Ops interactive workflow '${workflow}'.`,
    `Use the '${config.skillName}' skill for this workflow.`,
    `Repository working directory is: ${commandCwd}`,
    intakeSection,
    "Behavior requirements:",
    "- Ask one focused question at a time to collect missing values.",
    "- Keep responses concise and operational.",
    "- Before any mutating action (file writes or commands), present a summary and ask for explicit user confirmation.",
    "- If user does not confirm, do not execute writes.",
    ...workflowSpecific,
    `- When workflow is completed, output the exact token '${WORKFLOW_COMPLETE_SENTINEL}' on its own line.`,
    `- If user cancels, output the exact token '${WORKFLOW_CANCELLED_SENTINEL}' on its own line.`,
    config.firstQuestion,
    "Start now.",
  ].join("\n");
}

function hasWorkflowTerminalSignal(text: string): boolean {
  return text.includes(WORKFLOW_COMPLETE_SENTINEL) || text.includes(WORKFLOW_CANCELLED_SENTINEL);
}

function printInteractiveAssistantReply(text: string): void {
  const clean = text.trim();
  // eslint-disable-next-line no-console
  console.log(`\nassistant>\n${clean}\n`);
}

async function promptAndReadAssistant(
  client: PiRpcClient,
  userPrompt: string,
  previousAssistantText: string | null,
  timeoutMs: number,
  recentEventTypes: string[],
): Promise<string> {
  await client.prompt(userPrompt);

  const deadline = Date.now() + timeoutMs;
  let lastRpcError: Error | undefined;

  while (Date.now() < deadline) {
    try {
      const assistantText = await client.getLastAssistantText();
      if (assistantText && assistantText !== previousAssistantText) {
        return assistantText;
      }
    } catch (error) {
      lastRpcError = error instanceof Error ? error : new Error(String(error));
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }

  const eventSuffix =
    recentEventTypes.length > 0 ? ` Recent events: ${recentEventTypes.slice(-12).join(", ")}` : "";

  if (lastRpcError) {
    throw new Error(`Timed out waiting for assistant response. Last RPC error: ${lastRpcError.message}.${eventSuffix}`);
  }

  throw new Error(`Timed out waiting for assistant response.${eventSuffix}`);
}

async function askWithExit(
  readline: ReturnType<typeof createInterface>,
  prompt: string,
  validate?: (value: string) => string | null,
): Promise<string | null> {
  while (true) {
    const answer = (await readline.question(prompt)).trim();
    if (!answer) {
      continue;
    }
    if (answer === "/exit") {
      return null;
    }
    if (validate) {
      const message = validate(answer);
      if (message) {
        // eslint-disable-next-line no-console
        console.log(message);
        continue;
      }
    }
    return answer;
  }
}

async function askYesNoWithExit(
  readline: ReturnType<typeof createInterface>,
  prompt: string,
  defaultValue = true,
): Promise<boolean | null> {
  const suffix = defaultValue ? " [Y/n]: " : " [y/N]: ";
  while (true) {
    const answer = (await readline.question(`${prompt}${suffix}`)).trim().toLowerCase();
    if (answer === "/exit") {
      return null;
    }
    if (!answer) {
      return defaultValue;
    }
    if (answer === "y" || answer === "yes") {
      return true;
    }
    if (answer === "n" || answer === "no") {
      return false;
    }
    // eslint-disable-next-line no-console
    console.log("Please answer yes or no.");
  }
}

function yamlScalar(value: string | number | boolean): string {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (/^[a-zA-Z0-9._-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function parseNumericLike(value: string): number | string {
  if (/^\d+$/.test(value)) {
    const asNumber = Number(value);
    if (Number.isSafeInteger(asNumber)) {
      return asNumber;
    }
  }
  return value;
}

type AddChainDraft = {
  protocol: "cosmosnative" | "ethereum";
  name: string;
  displayName: string;
  chainId: number | string;
  domainId: number;
  isTestnet: boolean;
  rpcUrl: string;
  nativeSymbol: string;
  nativeName: string;
  nativeDecimals: number;
  bech32Prefix?: string;
  grpcUrl?: string;
  restUrl?: string;
  nativeDenom?: string;
};

function renderAddChainMetadataYaml(draft: AddChainDraft): string {
  const lines: string[] = [
    "# yaml-language-server: $schema=../schema.json",
    `chainId: ${yamlScalar(draft.chainId)}`,
    `displayName: ${yamlScalar(draft.displayName)}`,
    `domainId: ${yamlScalar(draft.domainId)}`,
    `isTestnet: ${yamlScalar(draft.isTestnet)}`,
    `name: ${yamlScalar(draft.name)}`,
    "nativeToken:",
    `  decimals: ${yamlScalar(draft.nativeDecimals)}`,
    `  name: ${yamlScalar(draft.nativeName)}`,
    `  symbol: ${yamlScalar(draft.nativeSymbol)}`,
  ];

  if (draft.protocol === "cosmosnative" && draft.nativeDenom) {
    lines.push(`  denom: ${yamlScalar(draft.nativeDenom)}`);
  }

  lines.push(
    `protocol: ${yamlScalar(draft.protocol)}`,
    "rpcUrls:",
    `  - http: ${yamlScalar(draft.rpcUrl)}`,
  );

  if (draft.protocol === "cosmosnative") {
    if (draft.bech32Prefix) {
      lines.push(`bech32Prefix: ${yamlScalar(draft.bech32Prefix)}`);
    }
    if (draft.nativeDenom) {
      lines.push(`canonicalAsset: ${yamlScalar(draft.nativeDenom)}`);
    }
    if (draft.grpcUrl) {
      lines.push("grpcUrls:", `  - http: ${yamlScalar(draft.grpcUrl)}`);
    }
    if (draft.restUrl) {
      lines.push("restUrls:", `  - http: ${yamlScalar(draft.restUrl)}`);
    }
  }

  lines.push("technicalStack: other");
  return lines.join("\n");
}

function printAddChainSummary(draft: AddChainDraft, filePath: string): void {
  // eslint-disable-next-line no-console
  console.log("\nSummary");
  // eslint-disable-next-line no-console
  console.log(`  Protocol: ${draft.protocol}`);
  // eslint-disable-next-line no-console
  console.log(`  Name: ${draft.name}`);
  // eslint-disable-next-line no-console
  console.log(`  Display name: ${draft.displayName}`);
  // eslint-disable-next-line no-console
  console.log(`  Chain ID: ${String(draft.chainId)}`);
  // eslint-disable-next-line no-console
  console.log(`  Domain ID: ${String(draft.domainId)}`);
  // eslint-disable-next-line no-console
  console.log(`  RPC URL: ${draft.rpcUrl}`);
  if (draft.protocol === "cosmosnative") {
    // eslint-disable-next-line no-console
    console.log(`  GRPC URL: ${draft.grpcUrl ?? "(not set)"}`);
    // eslint-disable-next-line no-console
    console.log(`  REST URL: ${draft.restUrl ?? "(not set)"}`);
    // eslint-disable-next-line no-console
    console.log(`  bech32 prefix: ${draft.bech32Prefix ?? "(not set)"}`);
  }
  // eslint-disable-next-line no-console
  console.log(`  Output file: ${filePath}`);
}

async function runAddChainWizard(parsed: Args): Promise<void> {
  const commandCwd = resolveCommandCwd(parsed);
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // eslint-disable-next-line no-console
  console.log("Starting Add Chain interactive session.");
  // eslint-disable-next-line no-console
  console.log("Type '/exit' at any prompt to stop.\n");

  try {
    const protocolInput = await askWithExit(readline, "Protocol (cosmosnative|ethereum): ", (value) => {
      const normalized = value.toLowerCase();
      if (normalized !== "cosmosnative" && normalized !== "ethereum") {
        return "Please enter 'cosmosnative' or 'ethereum'.";
      }
      return null;
    });
    if (!protocolInput) {
      // eslint-disable-next-line no-console
      console.log("Add-chain workflow exited.");
      return;
    }
    const protocol = protocolInput.toLowerCase() as "cosmosnative" | "ethereum";

    const name = await askWithExit(readline, "Chain name (e.g. edentestnet): ", (value) => {
      if (!/^[a-z][a-z0-9]*$/.test(value)) {
        return "Name must match ^[a-z][a-z0-9]*$.";
      }
      return null;
    });
    if (!name) {
      // eslint-disable-next-line no-console
      console.log("Add-chain workflow exited.");
      return;
    }

    const displayName = await askWithExit(readline, "Display name: ");
    if (!displayName) {
      // eslint-disable-next-line no-console
      console.log("Add-chain workflow exited.");
      return;
    }

    const chainIdInput = await askWithExit(readline, "Chain ID (numeric or string): ");
    if (!chainIdInput) {
      // eslint-disable-next-line no-console
      console.log("Add-chain workflow exited.");
      return;
    }
    const chainId = parseNumericLike(chainIdInput);

    const domainIdInput = await askWithExit(readline, "Domain ID (numeric): ", (value) => {
      if (!/^\d+$/.test(value)) {
        return "Domain ID must be a positive integer.";
      }
      const numeric = Number(value);
      if (!Number.isSafeInteger(numeric) || numeric <= 0) {
        return "Domain ID must be a safe positive integer.";
      }
      return null;
    });
    if (!domainIdInput) {
      // eslint-disable-next-line no-console
      console.log("Add-chain workflow exited.");
      return;
    }
    const domainId = Number(domainIdInput);

    const rpcUrl = await askWithExit(readline, "RPC URL: ", (value) => {
      if (!/^https?:\/\//.test(value)) {
        return "RPC URL must start with http:// or https://.";
      }
      return null;
    });
    if (!rpcUrl) {
      // eslint-disable-next-line no-console
      console.log("Add-chain workflow exited.");
      return;
    }

    const isTestnet = await askYesNoWithExit(readline, "Is this a testnet?", true);
    if (isTestnet === null) {
      // eslint-disable-next-line no-console
      console.log("Add-chain workflow exited.");
      return;
    }

    const nativeSymbol = await askWithExit(readline, "Native token symbol (e.g. ETH/TIA): ");
    if (!nativeSymbol) {
      // eslint-disable-next-line no-console
      console.log("Add-chain workflow exited.");
      return;
    }

    const nativeName = await askWithExit(readline, "Native token name (e.g. Ether/Celestia): ");
    if (!nativeName) {
      // eslint-disable-next-line no-console
      console.log("Add-chain workflow exited.");
      return;
    }

    const nativeDecimalsInput = await askWithExit(readline, "Native token decimals (e.g. 18 or 6): ", (value) => {
      if (!/^\d+$/.test(value)) {
        return "Decimals must be a non-negative integer.";
      }
      return null;
    });
    if (!nativeDecimalsInput) {
      // eslint-disable-next-line no-console
      console.log("Add-chain workflow exited.");
      return;
    }
    const nativeDecimals = Number(nativeDecimalsInput);

    let bech32Prefix: string | undefined;
    let grpcUrl: string | undefined;
    let restUrl: string | undefined;
    let nativeDenom: string | undefined;

    if (protocol === "cosmosnative") {
      bech32Prefix = (await askWithExit(readline, "bech32 prefix (e.g. celestia): ")) ?? undefined;
      if (!bech32Prefix) {
        // eslint-disable-next-line no-console
        console.log("Add-chain workflow exited.");
        return;
      }

      nativeDenom = (await askWithExit(readline, "Native denom (e.g. utia): ")) ?? undefined;
      if (!nativeDenom) {
        // eslint-disable-next-line no-console
        console.log("Add-chain workflow exited.");
        return;
      }

      grpcUrl = (await askWithExit(readline, "GRPC URL: ", (value) => {
        if (!/^https?:\/\//.test(value)) {
          return "GRPC URL must start with http:// or https://.";
        }
        return null;
      })) ?? undefined;
      if (!grpcUrl) {
        // eslint-disable-next-line no-console
        console.log("Add-chain workflow exited.");
        return;
      }

      restUrl = (await askWithExit(readline, "REST URL: ", (value) => {
        if (!/^https?:\/\//.test(value)) {
          return "REST URL must start with http:// or https://.";
        }
        return null;
      })) ?? undefined;
      if (!restUrl) {
        // eslint-disable-next-line no-console
        console.log("Add-chain workflow exited.");
        return;
      }
    }

    const draft: AddChainDraft = {
      protocol,
      name,
      displayName,
      chainId,
      domainId,
      isTestnet,
      rpcUrl,
      nativeSymbol,
      nativeName,
      nativeDecimals,
      bech32Prefix,
      grpcUrl,
      restUrl,
      nativeDenom,
    };

    const chainDir = resolve(commandCwd, "chains", name);
    const metadataPath = resolve(chainDir, "metadata.yaml");
    printAddChainSummary(draft, metadataPath);

    const yaml = renderAddChainMetadataYaml(draft);
    // eslint-disable-next-line no-console
    console.log("\nGenerated metadata.yaml preview:\n");
    // eslint-disable-next-line no-console
    console.log(`${yaml}\n`);

    if (existsSync(metadataPath)) {
      const overwrite = await askYesNoWithExit(readline, `File already exists at ${metadataPath}. Overwrite?`, false);
      if (overwrite === null || !overwrite) {
        // eslint-disable-next-line no-console
        console.log("No changes written.");
        return;
      }
    }

    const confirmed = await askYesNoWithExit(readline, "Write this file now?", false);
    if (confirmed === null || !confirmed) {
      // eslint-disable-next-line no-console
      console.log("No changes written.");
      return;
    }

    mkdirSync(chainDir, { recursive: true });
    writeFileSync(metadataPath, `${yaml}\n`, "utf8");
    // eslint-disable-next-line no-console
    console.log(`Wrote ${metadataPath}`);
  } finally {
    readline.close();
  }
}

async function collectInitialIntake(
  workflow: InteractiveWorkflow,
  readline: ReturnType<typeof createInterface>,
): Promise<string[] | null> {
  if (workflow === "add-chain") {
    // eslint-disable-next-line no-console
    console.log("Initial intake (type /exit any time):");
    const protocol = await askWithExit(readline, "Protocol (cosmosnative|ethereum): ", (value) => {
      const normalized = value.toLowerCase();
      if (normalized !== "cosmosnative" && normalized !== "ethereum") {
        return "Please enter 'cosmosnative' or 'ethereum'.";
      }
      return null;
    });
    if (!protocol) {
      return null;
    }
    const name = await askWithExit(readline, "Chain name (e.g. edentestnet): ", (value) => {
      if (!/^[a-z][a-z0-9]*$/.test(value)) {
        return "Name must match ^[a-z][a-z0-9]*$.";
      }
      return null;
    });
    if (!name) {
      return null;
    }
    const displayName = await askWithExit(readline, "Display name: ");
    if (!displayName) {
      return null;
    }
    return [
      `protocol=${protocol.toLowerCase()}`,
      `name=${name}`,
      `displayName=${displayName}`,
    ];
  }

  if (workflow === "hyperlane-core") {
    // eslint-disable-next-line no-console
    console.log("Initial intake (type /exit any time):");
    const action = await askWithExit(readline, "Action (deploy|apply|read): ", (value) => {
      const normalized = value.toLowerCase();
      if (!["deploy", "apply", "read"].includes(normalized)) {
        return "Please enter deploy, apply, or read.";
      }
      return null;
    });
    if (!action) {
      return null;
    }
    const chains = await askWithExit(readline, "Target chain(s), comma-separated: ");
    if (!chains) {
      return null;
    }
    return [`action=${action.toLowerCase()}`, `chains=${chains}`];
  }

  // warp-route
  // eslint-disable-next-line no-console
  console.log("Initial intake (type /exit any time):");
  const symbol = await askWithExit(readline, "Token symbol (e.g. USDC): ");
  if (!symbol) {
    return null;
  }
  const chains = await askWithExit(readline, "Route chains, comma-separated: ");
  if (!chains) {
    return null;
  }
  return [`symbol=${symbol}`, `chains=${chains}`];
}

async function runInteractiveWorkflow(workflow: InteractiveWorkflow, parsed: Args): Promise<void> {
  const commandCwd = resolveCommandCwd(parsed);
  const piRuntimeCwd = resolvePiRuntimeCwd(commandCwd);
  const timeoutMs = Number(parsed.flags.timeout ?? process.env.PI_RPC_TIMEOUT_MS ?? 180_000);
  const provider = typeof parsed.flags.provider === "string" ? parsed.flags.provider : process.env.PI_DEFAULT_PROVIDER;
  const model = typeof parsed.flags.model === "string" ? parsed.flags.model : process.env.PI_DEFAULT_MODEL;

  const client = new PiRpcClient({
    cwd: piRuntimeCwd,
    provider: provider || undefined,
    model: model || undefined,
    sessionDir: process.env.PI_SESSION_DIR,
    timeoutMs,
  });

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // eslint-disable-next-line no-console
  console.log(
    `Starting ${INTERACTIVE_WORKFLOW_CONFIG[workflow].title} interactive session.\nType '/exit' to stop.\n`,
  );

  const initialIntake = await collectInitialIntake(workflow, readline);
  if (!initialIntake) {
    // eslint-disable-next-line no-console
    console.log("Interactive workflow exited.");
    readline.close();
    return;
  }

  let lastAssistantText: string | null = null;
  const recentEventTypes: string[] = [];
  let unsubscribeEvents: (() => void) | undefined;

  try {
    await client.start();
    unsubscribeEvents = client.onEvent((event) => {
      const eventType = typeof event.type === "string" ? event.type : "unknown";
      recentEventTypes.push(eventType);
      if (recentEventTypes.length > 30) {
        recentEventTypes.shift();
      }
    });

    const kickoff = buildInteractiveKickoffPromptWithIntake(workflow, commandCwd, initialIntake);
    const firstReply = await promptAndReadAssistant(client, kickoff, lastAssistantText, timeoutMs, recentEventTypes);
    lastAssistantText = firstReply;
    printInteractiveAssistantReply(firstReply);

    while (true) {
      if (hasWorkflowTerminalSignal(lastAssistantText)) {
        return;
      }

      const userInput = (await readline.question("you> ")).trim();
      if (!userInput) {
        continue;
      }
      if (userInput === "/exit") {
        // eslint-disable-next-line no-console
        console.log("Interactive workflow exited.");
        return;
      }

      const reply = await promptAndReadAssistant(client, userInput, lastAssistantText, timeoutMs, recentEventTypes);
      lastAssistantText = reply;
      printInteractiveAssistantReply(reply);
    }
  } finally {
    unsubscribeEvents?.();
    readline.close();
    await client.stop();
  }
}

function printUsage(): void {
  // eslint-disable-next-line no-console
  console.log(`Hyperlane Ops Agent

Usage:
  ops-agent serve [--port 8787] [--cwd /path]
  ops-agent plan "<goal>" [--json] [--host http://127.0.0.1:8787]
  ops-agent info [--verify] [--json] [--host ...]
  ops-agent approve <planId> --all [--ttl 900] [--host ...]
  ops-agent approve <planId> --hash <hash> [--hash <hash2>] [--ttl 900] [--host ...]
  ops-agent execute <planId> --token <token> [--host ...]
  ops-agent run "<goal>" --read-only [--host ...]
  ops-agent add-chain [--cwd /path]
  ops-agent hyperlane-core [--cwd /path]
  ops-agent warp-route [--cwd /path]

Help:
  ops-agent help
  ops-agent help <command>
  ops-agent <command> --help`);
}

function printCommandUsage(command: string): boolean {
  const message = COMMAND_HELP[command];
  if (!message) {
    return false;
  }
  // eslint-disable-next-line no-console
  console.log(message);
  return true;
}

function wantsHelp(parsed: Args): boolean {
  return parsed.flags.help === true;
}

function yesNo(value: boolean | undefined): string {
  return value ? "yes" : "no";
}

function asDisplayValue(value: string | undefined): string {
  return value && value.trim().length ? value : "(not set)";
}

function renderInfoHuman(info: InfoResponse): string {
  const lines: string[] = [];
  const provider = info.model?.provider ?? "";
  const model = info.model?.model ?? "";
  const creds = info.credentials ?? {};
  const runtime = info.runtime ?? {};

  lines.push("Hyperlane Ops Agent Info");
  lines.push("");
  lines.push("Model");
  lines.push(`  Provider: ${asDisplayValue(provider)}`);
  lines.push(`  Model: ${asDisplayValue(model)}`);
  lines.push("");
  lines.push("Credentials");
  lines.push(`  OPENAI_API_KEY present: ${yesNo(creds.openaiApiKeyPresent)}`);
  lines.push(`  HYP_KEY present: ${yesNo(creds.hypKeyPresent)}`);
  lines.push(`  HYP_KEY_COSMOSNATIVE present: ${yesNo(creds.hypKeyCosmosnativePresent)}`);
  lines.push(`  Auth file path: ${asDisplayValue(creds.authFilePath)}`);
  lines.push(`  Auth file present: ${yesNo(creds.authFilePresent)}`);
  lines.push(`  Auth has OpenAI API key: ${yesNo(creds.authFileHasOpenAiApiKey)}`);
  lines.push(`  Auth has openai-codex OAuth: ${yesNo(creds.authFileHasOpenAiCodexOAuth)}`);
  if (creds.authFileParseError) {
    lines.push(`  Auth parse error: ${creds.authFileParseError}`);
  }
  lines.push("");
  lines.push("Runtime");
  lines.push(`  CWD: ${asDisplayValue(runtime.cwd)}`);
  lines.push(`  PI_SESSION_DIR: ${asDisplayValue(runtime.sessionDir)}`);
  lines.push(`  Skills: ${JSON.stringify(runtime.skills ?? [])}`);

  if (info.verification?.requested) {
    lines.push("");
    lines.push("Verification");
    lines.push(`  Result: ${info.verification.ok ? "ok" : "failed"}`);
    lines.push(`  Provider: ${asDisplayValue(info.verification.provider)}`);
    lines.push(`  Model: ${asDisplayValue(info.verification.model)}`);
    if (info.verification.error) {
      lines.push(`  Error: ${info.verification.error}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const [command] = parsed._;
  const host = typeof parsed.flags.host === "string" ? parsed.flags.host : "http://127.0.0.1:8787";

  if (!command) {
    printUsage();
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    const topic = parsed._[1];
    if (!topic) {
      printUsage();
      return;
    }
    if (!printCommandUsage(topic)) {
      throw new Error(`Unknown command '${topic}'. Run 'ops-agent help' for available commands.`);
    }
    return;
  }

  if (command === "serve") {
    if (wantsHelp(parsed)) {
      printCommandUsage("serve");
      return;
    }
    if (typeof parsed.flags.port === "string") {
      process.env.OPS_AGENT_PORT = parsed.flags.port;
    }
    if (typeof parsed.flags.cwd === "string") {
      process.env.OPS_AGENT_CWD = resolve(parsed.flags.cwd);
    }
    await startServer();
    return;
  }

  if (command === "plan") {
    if (wantsHelp(parsed)) {
      printCommandUsage("plan");
      return;
    }
    const goal = parsed._.slice(1).join(" ").trim();
    if (!goal) {
      throw new Error("Missing plan goal");
    }

    const response = await postJson(host, "/v1/plan", { goal });
    if (parsed.flags.json) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (command === "info") {
    if (wantsHelp(parsed)) {
      printCommandUsage("info");
      return;
    }
    const verify = Boolean(parsed.flags.verify);
    const path = verify ? "/v1/info?verify=1" : "/v1/info";
    const response = (await getJson(host, path)) as InfoResponse;
    if (parsed.flags.json) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    // eslint-disable-next-line no-console
    process.stdout.write(renderInfoHuman(response));
    return;
  }

  if (command === "approve") {
    if (wantsHelp(parsed)) {
      printCommandUsage("approve");
      return;
    }
    const planId = parsed._[1];
    if (!planId) {
      throw new Error("Missing planId");
    }

    const ttlSeconds = Number(parsed.flags.ttl ?? 900);

    if (parsed.flags.all) {
      const plan = (await getJson(host, `/v1/plans/${planId}`)) as {
        commands?: Array<{ hash: string; class: string }>;
      };
      const hashes = plan.commands?.filter((item) => item.class !== "blocked").map((item) => item.hash) ?? [];
      const response = await postJson(host, "/v1/approve", {
        planId,
        commandHashes: hashes,
        ttlSeconds,
      });
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    const hashFlag = parsed.flags.hash;
    const hashes = Array.isArray(hashFlag)
      ? hashFlag.filter((item): item is string => typeof item === "string")
      : typeof hashFlag === "string"
        ? [hashFlag]
        : [];

    if (!hashes.length) {
      throw new Error("Use --all or provide at least one --hash value");
    }

    const response = await postJson(host, "/v1/approve", {
      planId,
      commandHashes: hashes,
      ttlSeconds,
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (command === "execute") {
    if (wantsHelp(parsed)) {
      printCommandUsage("execute");
      return;
    }
    const planId = parsed._[1];
    if (!planId) {
      throw new Error("Missing planId");
    }

    const token = requireString(parsed.flags.token, "token");
    const response = await postJson(host, "/v1/execute", {
      planId,
      approvalToken: token,
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (command === "run") {
    if (wantsHelp(parsed)) {
      printCommandUsage("run");
      return;
    }
    const goal = parsed._.slice(1).join(" ").trim();
    if (!goal) {
      throw new Error("Missing run goal");
    }

    const plan = (await postJson(host, "/v1/plan", { goal })) as { planId: string };
    const response = await postJson(host, "/v1/execute", {
      planId: plan.planId,
      readOnly: true,
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (command === "add-chain") {
    if (wantsHelp(parsed)) {
      printCommandUsage("add-chain");
      return;
    }
    await runAddChainWizard(parsed);
    return;
  }

  if (command === "hyperlane-core" || command === "warp-route") {
    if (wantsHelp(parsed)) {
      printCommandUsage(command);
      return;
    }
    await runInteractiveWorkflow(command, parsed);
    return;
  }

  throw new Error(`Unknown command '${command}'. Run 'ops-agent help' for available commands.`);
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
