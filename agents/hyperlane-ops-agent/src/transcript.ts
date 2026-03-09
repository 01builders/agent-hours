import type { RunEvent } from "./types.js";

const SECRET_ENV_VARS = [
  "HYP_KEY",
  "HYP_KEY_COSMOSNATIVE",
  "HYP_MNEMONIC",
  "HYP_CHAINS_CELESTIATESTNET_SIGNER_KEY",
  "HYP_CHAINS_EDENTESTNET_SIGNER_KEY",
  "HYP_CHAINS_SEPOLIA_SIGNER_KEY",
  "FORWARD_RELAYER_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
];

export function redactSecrets(input: string): string {
  let output = input;

  for (const key of SECRET_ENV_VARS) {
    const value = process.env[key];
    if (!value) {
      continue;
    }
    output = output.split(value).join(`[REDACTED:${key}]`);
  }

  return output;
}

export function makeRunEvent(
  kind: RunEvent["kind"],
  message: string,
  commandHash?: string,
): RunEvent {
  return {
    at: new Date().toISOString(),
    kind,
    message: redactSecrets(message),
    commandHash,
  };
}
