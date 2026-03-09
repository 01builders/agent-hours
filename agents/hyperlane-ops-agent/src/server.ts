import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import {
  ApproveRequestSchema,
  type ApproveRequest,
  ExecuteRequestSchema,
  type ExecuteRequest,
  PlanRequestSchema,
  type PlanRequest,
} from "./api-schema.js";
import { PiDecisionEngine } from "./decision-engine.js";
import { createMetrics } from "./metrics.js";
import { OpsOrchestrator } from "./orchestrator.js";
import { PiRpcClient } from "./pi-rpc-client.js";
import { PlanStore } from "./plan-store.js";
import { validateBody } from "./validation.js";

function hasEnv(name: string): boolean {
  return Boolean(process.env[name] && process.env[name]?.trim().length);
}

function authFilePath(): string {
  if (process.env.PI_AUTH_FILE && process.env.PI_AUTH_FILE.trim().length > 0) {
    return process.env.PI_AUTH_FILE;
  }
  return resolve(homedir(), ".pi/agent/auth.json");
}

function resolveStateStorePath(baseCwd: string): string {
  if (process.env.OPS_AGENT_STATE_FILE && process.env.OPS_AGENT_STATE_FILE.trim().length > 0) {
    return resolve(baseCwd, process.env.OPS_AGENT_STATE_FILE.trim());
  }

  const monorepoOpsAgentDir = resolve(baseCwd, "ops-agent");
  if (existsSync(resolve(monorepoOpsAgentDir, "package.json"))) {
    return resolve(monorepoOpsAgentDir, "state/store.json");
  }

  return resolve(baseCwd, "state/store.json");
}

function resolvePiProjectCwd(baseCwd: string): string {
  if (process.env.PI_PROJECT_CWD && process.env.PI_PROJECT_CWD.trim().length > 0) {
    return resolve(process.env.PI_PROJECT_CWD.trim());
  }

  const candidates = [baseCwd, resolve(baseCwd, ".."), resolve(baseCwd, "ops-agent")];
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

  return baseCwd;
}

function tryReadSettingsSkillPaths(piProjectCwd: string): string[] {
  const settingsPath = resolve(piProjectCwd, ".pi/settings.json");
  if (!existsSync(settingsPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as { skills?: unknown };
    if (!Array.isArray(parsed.skills)) {
      return [];
    }
    const piDir = resolve(piProjectCwd, ".pi");
    return parsed.skills.filter((item): item is string => typeof item === "string").map((item) => resolve(piDir, item));
  } catch {
    return [];
  }
}

function collectSkillNamesFromPath(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }

  const stat = statSync(path);
  if (stat.isFile() && extname(path).toLowerCase() === ".md") {
    const file = basename(path);
    if (file === "SKILL.md") {
      return [basename(resolve(path, ".."))];
    }
    return [file.slice(0, -3)];
  }

  if (!stat.isDirectory()) {
    return [];
  }

  const names: string[] = [];
  const entries = readdirSync(path, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      if (entry.name === "SKILL.md") {
        names.push(basename(path));
      } else {
        names.push(entry.name.slice(0, -3));
      }
      continue;
    }

    if (!entry.isDirectory()) {
      continue;
    }

    const skillPath = resolve(path, entry.name, "SKILL.md");
    if (existsSync(skillPath)) {
      names.push(entry.name);
    }
  }

  return names;
}

function discoverAvailableSkills(baseCwd: string): string[] {
  const piProjectCwd = resolvePiProjectCwd(baseCwd);
  const configuredRoots = tryReadSettingsSkillPaths(piProjectCwd);
  const defaultRoot = resolve(piProjectCwd, ".pi/skills");
  const roots = [...new Set([defaultRoot, ...configuredRoots])];

  const names = new Set<string>();
  for (const root of roots) {
    for (const name of collectSkillNamesFromPath(root)) {
      names.add(name);
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

function authFileInfo(filePath: string): {
  present: boolean;
  hasOpenAiApiKey: boolean;
  hasOpenAiCodexOAuth: boolean;
  parseError?: string;
} {
  if (!existsSync(filePath)) {
    return {
      present: false,
      hasOpenAiApiKey: false,
      hasOpenAiCodexOAuth: false,
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const openai = parsed.openai;
    const openaiCodex = parsed["openai-codex"];

    const hasOpenAiApiKey =
      !!openai && typeof openai === "object" && (openai as { type?: string }).type === "api_key";
    const hasOpenAiCodexOAuth =
      !!openaiCodex && typeof openaiCodex === "object" && (openaiCodex as { type?: string }).type === "oauth";

    return {
      present: true,
      hasOpenAiApiKey,
      hasOpenAiCodexOAuth,
    };
  } catch (error) {
    return {
      present: true,
      hasOpenAiApiKey: false,
      hasOpenAiCodexOAuth: false,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifyPi(baseCwd: string): Promise<{ ok: boolean; provider: string; model: string; error?: string }> {
  const provider = process.env.PI_DEFAULT_PROVIDER ?? "";
  const model = process.env.PI_DEFAULT_MODEL ?? "";
  const client = new PiRpcClient({
    cwd: baseCwd,
    provider: provider || undefined,
    model: model || undefined,
    sessionDir: process.env.PI_SESSION_DIR,
    timeoutMs: 30_000,
  });

  try {
    await client.start();
    await client.promptAndWait(
      "Reply with a JSON object only: {\"status\":\"ok\"}",
      30_000,
    );
    const text = await client.getLastAssistantText();
    if (!text || !text.trim().length) {
      throw new Error("Pi returned empty response");
    }
    return { ok: true, provider, model };
  } catch (error) {
    return {
      ok: false,
      provider,
      model,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.stop();
  }
}

export async function startServer(): Promise<void> {
  const port = Number(process.env.OPS_AGENT_PORT ?? 8787);
  const baseCwd = process.env.OPS_AGENT_CWD ? resolve(process.env.OPS_AGENT_CWD) : process.cwd();

  const metrics = createMetrics();
  const store = new PlanStore(resolveStateStorePath(baseCwd));
  const orchestrator = new OpsOrchestrator({
    baseCwd,
    decisionEngine: new PiDecisionEngine(),
    store,
    metrics,
  });
  const app = Fastify({
    logger: false,
    bodyLimit: 1_000_000,
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: "Not found" });
  });

  app.setErrorHandler((error, _request, reply) => {
    const candidateStatus = (error as { statusCode?: number }).statusCode;
    const statusCode = typeof candidateStatus === "number" && candidateStatus >= 400 ? candidateStatus : 400;
    const message = error instanceof Error ? error.message : String(error);
    reply.code(statusCode).send({
      error: message,
    });
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/metrics", async (_request, reply) => {
    const body = await metrics.registry.metrics();
    reply.type("text/plain; charset=utf-8").send(body);
  });

  app.get<{ Querystring: { verify?: string } }>("/v1/info", async (request) => {
    const verify = request.query.verify === "1" || request.query.verify === "true";
    const authPath = authFilePath();
    const authInfo = authFileInfo(authPath);
    const skills = discoverAvailableSkills(baseCwd);

    const payload: {
      model: {
        provider: string;
        model: string;
      };
      credentials: {
        openaiApiKeyPresent: boolean;
        hypKeyPresent: boolean;
        hypKeyCosmosnativePresent: boolean;
        authFilePath: string;
        authFilePresent: boolean;
        authFileHasOpenAiApiKey: boolean;
        authFileHasOpenAiCodexOAuth: boolean;
        authFileParseError?: string;
      };
      runtime: {
        cwd: string;
        sessionDir: string;
        skills: string[];
      };
      verification?: {
        requested: true;
        ok: boolean;
        provider: string;
        model: string;
        error?: string;
      };
    } = {
      model: {
        provider: process.env.PI_DEFAULT_PROVIDER ?? "",
        model: process.env.PI_DEFAULT_MODEL ?? "",
      },
      credentials: {
        openaiApiKeyPresent: hasEnv("OPENAI_API_KEY"),
        hypKeyPresent: hasEnv("HYP_KEY"),
        hypKeyCosmosnativePresent: hasEnv("HYP_KEY_COSMOSNATIVE"),
        authFilePath: authPath,
        authFilePresent: authInfo.present,
        authFileHasOpenAiApiKey: authInfo.hasOpenAiApiKey,
        authFileHasOpenAiCodexOAuth: authInfo.hasOpenAiCodexOAuth,
        authFileParseError: authInfo.parseError,
      },
      runtime: {
        cwd: baseCwd,
        sessionDir: process.env.PI_SESSION_DIR ?? "",
        skills,
      },
    };

    if (verify) {
      payload.verification = {
        requested: true,
        ...(await verifyPi(baseCwd)),
      };
    }

    return payload;
  });

  app.post<{ Body: unknown }>("/v1/plan", async (request) => {
    const parsed = validateBody<PlanRequest>(PlanRequestSchema, request.body);
    const result = await orchestrator.createPlan(parsed.goal, parsed.context, parsed.cwd);
    return {
      planId: result.plan.id,
      summary: result.plan.summary,
      commands: result.plan.commands,
      rawResponse: result.rawResponse,
    };
  });

  app.get<{ Params: { planId: string } }>("/v1/plans/:planId", async (request, reply) => {
    const plan = orchestrator.getPlan(request.params.planId);
    if (!plan) {
      reply.code(404);
      return { error: "Plan not found" };
    }

    return plan;
  });

  app.post<{ Body: unknown }>("/v1/approve", async (request) => {
    const parsed = validateBody<ApproveRequest>(ApproveRequestSchema, request.body);
    const approval = orchestrator.approve(parsed.planId, parsed.commandHashes, parsed.ttlSeconds ?? 900);
    return {
      approvalToken: approval.token,
      expiresAt: approval.expiresAt,
    };
  });

  app.post<{ Body: unknown }>("/v1/execute", async (request, reply) => {
    const parsed = validateBody<ExecuteRequest>(ExecuteRequestSchema, request.body);
    const execution = await orchestrator.execute(parsed.planId, {
      approvalToken: parsed.approvalToken,
      readOnly: parsed.readOnly,
    });
    reply.code(202);
    return execution;
  });

  app.get<{ Params: { runId: string } }>("/v1/runs/:runId", async (request, reply) => {
    const run = orchestrator.getRun(request.params.runId);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }

    return run;
  });

  app.get<{ Params: { runId: string } }>("/v1/runs/:runId/events", async (request, reply) => {
    const run = orchestrator.getRun(request.params.runId);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }

    const ndjson = `${run.transcript.map((event) => JSON.stringify(event)).join("\n")}\n`;
    reply.type("text/plain; charset=utf-8").send(ndjson);
  });

  await app.listen({
    port,
    host: "0.0.0.0",
  });
  // eslint-disable-next-line no-console
  console.log(`ops-agent listening on :${port}`);
}

async function main(): Promise<void> {
  await startServer();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
