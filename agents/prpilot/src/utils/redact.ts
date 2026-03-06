const SENSITIVE_KEY_RE = /(token|secret|password|private.?key|api.?key|authorization|cookie|session)/i;

export function redactField(key: string, value: unknown): string {
  const text = stringifyValue(value);
  if (SENSITIVE_KEY_RE.test(key)) return "***REDACTED***";
  return redactText(text);
}

export function redactText(input: string): string {
  let output = input;

  // Common key=value formats
  output = output.replace(
    /\b([A-Z0-9_]*(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|AUTHORIZATION|COOKIE)[A-Z0-9_]*)=([^\s]+)/gi,
    "$1=***REDACTED***",
  );

  // JSON-style sensitive values
  output = output.replace(
    /"(token|secret|password|privateKey|private_key|apiKey|api_key|authorization|cookie)"\s*:\s*"[^"]*"/gi,
    '"$1":"***REDACTED***"',
  );

  // Bearer tokens
  output = output.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***REDACTED***");

  // GitHub token patterns
  output = output.replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, "***REDACTED***");

  // Telegram bot token format: digits:token
  output = output.replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "***REDACTED***");

  // PEM private keys
  output = output.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "***REDACTED_PRIVATE_KEY***",
  );

  return output;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return String(value);
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[unserializable-object]";
    }
  }
  return String(value);
}
