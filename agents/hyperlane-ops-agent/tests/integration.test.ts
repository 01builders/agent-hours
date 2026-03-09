import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import type { DecisionEngine } from "../src/types.js";
import { PlanStore } from "../src/plan-store.js";
import { createMetrics } from "../src/metrics.js";
import { OpsOrchestrator } from "../src/orchestrator.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCompletion(orchestrator: OpsOrchestrator, runId: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const run = orchestrator.getRun(runId);
    if (run && (run.status === "completed" || run.status === "failed")) {
      return;
    }
    await sleep(10);
  }
  throw new Error("Run did not complete in time");
}

class MockDecisionEngine implements DecisionEngine {
  async createPlan() {
    return {
      summary: "mock summary",
      commands: ["docker compose ps", "docker compose restart relayer"],
    };
  }
}

class CoreWrapperDecisionEngine implements DecisionEngine {
  async createPlan() {
    return {
      summary: "core wrapper summary",
      commands: [
        "test -f chains/evolve1/metadata.yaml",
        "test -f configs/evolve1-core.yaml",
        "if [ -f chains/evolve1/metadata.yaml ]; then hyperlane core deploy --registry . --chain evolve1 --config configs/evolve1-core.yaml; fi",
        "hyperlane core read --registry . --chain evolve1 --config configs/evolve1-core.yaml",
      ],
    };
  }
}

describe("orchestrator integration", () => {
  test("read-only run skips mutating command", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ops-agent-int-"));
    const store = new PlanStore(join(dir, "store.json"));
    const metrics = createMetrics();
    const orchestrator = new OpsOrchestrator({
      baseCwd: process.cwd(),
      decisionEngine: new MockDecisionEngine(),
      store,
      metrics,
      executor: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
    });

    const { plan } = await orchestrator.createPlan("check relayer");
    const execution = await orchestrator.execute(plan.id, { readOnly: true });

    await waitForCompletion(orchestrator, execution.runId);

    const run = orchestrator.getRun(execution.runId);
    expect(run?.status).toBe("completed");
    expect(run?.commands.some((command) => command.status === "skipped")).toBe(true);
  });

  test("approved run executes mutating command", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ops-agent-int-"));
    const store = new PlanStore(join(dir, "store.json"));
    const metrics = createMetrics();
    const orchestrator = new OpsOrchestrator({
      baseCwd: process.cwd(),
      decisionEngine: new MockDecisionEngine(),
      store,
      metrics,
      executor: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
    });

    const { plan } = await orchestrator.createPlan("restart relayer");
    const approval = orchestrator.approve(
      plan.id,
      plan.commands.filter((command) => command.class !== "blocked").map((command) => command.hash),
      600,
    );

    const execution = await orchestrator.execute(plan.id, { approvalToken: approval.token });
    await waitForCompletion(orchestrator, execution.runId);

    const run = orchestrator.getRun(execution.runId);
    expect(run?.status).toBe("completed");
    expect(run?.commands.some((command) => command.class === "write" && command.status === "executed")).toBe(true);
  });

  test("sanitizes planner shell wrappers into allowlisted core commands", async () => {
    process.env.HYP_KEY = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const dir = mkdtempSync(join(tmpdir(), "ops-agent-int-"));
    mkdirSync(join(dir, "chains", "evolve1"), { recursive: true });
    writeFileSync(join(dir, "chains", "evolve1", "metadata.yaml"), "protocol: ethereum\n", "utf8");
    const store = new PlanStore(join(dir, "store.json"));
    const metrics = createMetrics();
    const orchestrator = new OpsOrchestrator({
      baseCwd: dir,
      decisionEngine: new CoreWrapperDecisionEngine(),
      store,
      metrics,
      executor: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
    });

    const { plan } = await orchestrator.createPlan("deploy hyperlane core on chain evolve1");

    expect(plan.commands.some((command) => command.command.startsWith("test -f"))).toBe(false);
    expect(plan.commands.some((command) => command.command.includes("if [ -f"))).toBe(false);
    expect(plan.commands.some((command) => command.command.startsWith("hyperlane core deploy"))).toBe(true);
    expect(plan.commands.some((command) => command.class === "write")).toBe(true);
  });
});
