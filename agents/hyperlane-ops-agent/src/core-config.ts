import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CORE_EXAMPLE_CONFIG = "configs/core-config.example.yaml";
const CORE_EXAMPLE_BASENAME = "core-config.example.yaml";
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const HEX_KEY_REGEX = /^(?:0x)?[a-fA-F0-9]{64}$/;

type CoreAction = "read" | "deploy" | "apply";

export interface CoreCommandDetails {
  action: CoreAction;
  chain?: string;
  configPath?: string;
}

export interface CoreCommandNormalization {
  command: string;
  changed: boolean;
  chain?: string;
  configPath?: string;
}

export interface PrepareCoreDeployOptions {
  resolveOwnerAddress?: (privateKey: string) => string;
}

export interface PrepareCoreDeployResult {
  command: string;
  notes: string[];
}

function getFlagValue(command: string, ...flags: string[]): string | undefined {
  const tokens = command.split(/\s+/);
  for (let i = 0; i < tokens.length; i += 1) {
    if (flags.includes(tokens[i]) && tokens[i + 1]) {
      return tokens[i + 1];
    }
  }
  return undefined;
}

function setFlagValue(command: string, flag: string, value: string): { command: string; changed: boolean } {
  const pattern = new RegExp(`(?:^|\\s)${flag}\\s+([^\\s]+)`, "i");
  if (!pattern.test(command)) {
    return {
      command: `${command} ${flag} ${value}`.trim(),
      changed: true,
    };
  }

  const next = command.replace(pattern, (match) => {
    const prefix = match.startsWith(" ") ? " " : "";
    return `${prefix}${flag} ${value}`;
  });
  return {
    command: next,
    changed: normalizePathLike(getFlagValue(command, flag)) !== normalizePathLike(value),
  };
}

function normalizePathLike(pathLike: string | undefined): string {
  if (!pathLike) {
    return "";
  }
  return pathLike.replace(/^\.\//, "");
}

function defaultCoreConfigPath(chain: string): string {
  return `configs/${chain}-core.yaml`;
}

function normalizePrivateKey(hypKey: string): string {
  const trimmed = hypKey.trim();
  if (!HEX_KEY_REGEX.test(trimmed)) {
    throw new Error("HYP_KEY must be a 32-byte hex private key");
  }
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function deriveAddressWithCast(privateKey: string): string {
  try {
    const stdout = execFileSync("cast", ["wallet", "address", "--private-key", privateKey], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const address = stdout.trim();
    if (!EVM_ADDRESS_REGEX.test(address)) {
      throw new Error(`Unexpected cast output: ${address}`);
    }
    return address;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to derive owner address from HYP_KEY via cast wallet address. Ensure Foundry cast is installed and HYP_KEY is valid. Details: ${message}`,
    );
  }
}

function updateOwnerFields(configContent: string, ownerAddress: string): string {
  return configContent.replace(/^(\s*)(owner|beneficiary):\s*.*$/gm, (_match, indent: string, key: string) => {
    return `${indent}${key}: "${ownerAddress}"`;
  });
}

function detectChainProtocol(cwd: string, chain: string): string | undefined {
  const metadataPath = resolve(cwd, "chains", chain, "metadata.yaml");
  if (!existsSync(metadataPath)) {
    return undefined;
  }

  try {
    const content = readFileSync(metadataPath, "utf8");
    const match = content.match(/^\s*protocol:\s*([^\s#]+)\s*$/m);
    return match?.[1]?.trim().toLowerCase();
  } catch {
    return undefined;
  }
}

function usesExampleConfig(configPath: string): boolean {
  const normalized = normalizePathLike(configPath);
  return normalized.endsWith(`/${CORE_EXAMPLE_BASENAME}`) || normalized === CORE_EXAMPLE_BASENAME;
}

export function parseCoreCommand(command: string): CoreCommandDetails | null {
  const match = command.match(/^hyperlane\s+core\s+(read|deploy|apply)\b/i);
  if (!match) {
    return null;
  }
  const action = match[1].toLowerCase() as CoreAction;
  return {
    action,
    chain: getFlagValue(command, "--chain"),
    configPath: getFlagValue(command, "--config"),
  };
}

export function normalizeCoreCommandConfig(command: string): CoreCommandNormalization {
  const details = parseCoreCommand(command);
  if (!details?.chain) {
    return {
      command,
      changed: false,
    };
  }

  const wanted = defaultCoreConfigPath(details.chain);

  if (!details.configPath) {
    const appended = setFlagValue(command, "--config", wanted);
    return {
      command: appended.command,
      changed: appended.changed,
      chain: details.chain,
      configPath: wanted,
    };
  }

  if (usesExampleConfig(details.configPath)) {
    const replaced = setFlagValue(command, "--config", wanted);
    return {
      command: replaced.command,
      changed: replaced.changed,
      chain: details.chain,
      configPath: wanted,
    };
  }

  return {
    command,
    changed: false,
    chain: details.chain,
    configPath: details.configPath,
  };
}

export function prepareCoreDeployCommand(
  command: string,
  cwd: string,
  options: PrepareCoreDeployOptions = {},
): PrepareCoreDeployResult {
  const normalized = normalizeCoreCommandConfig(command);
  const details = parseCoreCommand(normalized.command);
  if (!details || (details.action !== "deploy" && details.action !== "apply")) {
    return {
      command: normalized.command,
      notes: [],
    };
  }

  const chain = details.chain;
  if (!chain) {
    throw new Error("hyperlane core deploy/apply commands must include --chain");
  }

  const configPath = details.configPath ?? defaultCoreConfigPath(chain);
  const protocol = detectChainProtocol(cwd, chain);
  if (protocol === "cosmosnative") {
    return {
      command: normalized.command,
      notes: [
        `Core config templating skipped for cosmosnative chain '${chain}'. Using existing config at ${configPath}.`,
      ],
    };
  }

  const templatePath = resolve(cwd, CORE_EXAMPLE_CONFIG);
  if (!existsSync(templatePath)) {
    throw new Error(`Core template not found: ${templatePath}`);
  }

  const targetPath = resolve(cwd, configPath);
  const notes: string[] = [];
  if (!existsSync(targetPath)) {
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(templatePath, targetPath);
    notes.push(`Created ${configPath} from ${CORE_EXAMPLE_CONFIG}`);
  }

  const hypKey = process.env.HYP_KEY;
  if (!hypKey || !hypKey.trim().length) {
    throw new Error("Missing required env var HYP_KEY for core deployment owner resolution");
  }

  const ownerResolver = options.resolveOwnerAddress ?? deriveAddressWithCast;
  const ownerAddress = ownerResolver(normalizePrivateKey(hypKey));
  if (!EVM_ADDRESS_REGEX.test(ownerAddress)) {
    throw new Error("Resolved owner address is not a valid EVM address");
  }

  const currentConfig = readFileSync(targetPath, "utf8");
  const nextConfig = updateOwnerFields(currentConfig, ownerAddress);
  if (nextConfig !== currentConfig) {
    writeFileSync(targetPath, nextConfig, "utf8");
    notes.push(`Updated owner/beneficiary fields in ${configPath} to ${ownerAddress}`);
  } else {
    notes.push(`Validated owner/beneficiary fields in ${configPath}`);
  }

  return {
    command: normalized.command,
    notes,
  };
}
