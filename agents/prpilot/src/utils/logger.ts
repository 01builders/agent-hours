import { AsyncLocalStorage } from "node:async_hooks";
import { redactField, redactText } from "./redact.js";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

type LogFields = Record<string, unknown>;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

let activeLevel: LogLevel = "INFO";
const contextStorage = new AsyncLocalStorage<LogFields>();

function quoteIfNeeded(value: unknown): string {
  const raw = String(value);
  if (/^[a-zA-Z0-9._:/-]+$/.test(raw)) return raw;
  return JSON.stringify(raw);
}

function formatLine(level: LogLevel, message: string, fields: LogFields = {}): string {
  const contextFields = contextStorage.getStore() ?? {};
  const mergedFields = { ...contextFields, ...fields };

  const safeMessage = redactText(message);
  const base = [`level=${level}`, `msg=${quoteIfNeeded(safeMessage)}`];
  const extras = Object.entries(mergedFields).map(([k, v]) => `${k}=${quoteIfNeeded(redactField(k, v))}`);
  return [...base, ...extras].join(" ");
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[activeLevel];
}

function normalizeLevel(level: string): LogLevel {
  const normalized = level.toUpperCase();
  if (normalized === "DEBUG" || normalized === "INFO" || normalized === "WARN" || normalized === "ERROR") {
    return normalized;
  }
  return "INFO";
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  if (!shouldLog(level)) return;
  process.stderr.write(`${formatLine(level, message, fields)}\n`);
}

export const logger = {
  setLevel(level: string): void {
    activeLevel = normalizeLevel(level);
    emit("INFO", "logger level set", { logLevel: activeLevel });
  },
  getLevel(): LogLevel {
    return activeLevel;
  },
  withContext<T>(fields: LogFields, fn: () => Promise<T>): Promise<T> {
    const parent = contextStorage.getStore() ?? {};
    return contextStorage.run({ ...parent, ...fields }, fn);
  },
  debug(message: string, fields?: LogFields): void {
    emit("DEBUG", message, fields);
  },
  info(message: string, fields?: LogFields): void {
    emit("INFO", message, fields);
  },
  warn(message: string, fields?: LogFields): void {
    emit("WARN", message, fields);
  },
  error(message: string, fields?: LogFields): void {
    emit("ERROR", message, fields);
  },
};
