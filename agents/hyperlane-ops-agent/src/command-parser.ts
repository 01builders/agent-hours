import { createHash } from "node:crypto";

const CONTROL_OPERATORS = ["&&", "||", "|", ";"];

export function splitCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed.length > 0) {
      segments.push(trimmed);
    }
    current = "";
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      current += ch;
      escaped = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      current += ch;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }

    const twoChar = command.slice(i, i + 2);
    if (CONTROL_OPERATORS.includes(twoChar)) {
      flush();
      i += 1;
      continue;
    }

    if (CONTROL_OPERATORS.includes(ch)) {
      flush();
      continue;
    }

    current += ch;
  }

  flush();
  return segments;
}

export function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

export function hashCommand(command: string): string {
  return createHash("sha256").update(normalizeCommand(command)).digest("hex");
}

export function looksLikeWriteToSensitiveFile(command: string): boolean {
  const lower = command.toLowerCase();
  if (!lower.includes(".env")) {
    return false;
  }

  if (lower.includes(">") || lower.includes("tee") || lower.includes("cat <<") || lower.includes("printf")) {
    return true;
  }

  if (lower.includes("sed -i") || lower.includes("perl -i") || lower.includes("python") || lower.includes("node")) {
    return true;
  }

  return true;
}
