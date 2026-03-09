import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { FallbackDecisionEngine } from "../src/decision-engine.js";

describe("fallback decision engine", () => {
  test("does not inject hardcoded chain for core plan when chain is not provided", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ops-agent-fallback-"));
    const engine = new FallbackDecisionEngine();

    const plan = await engine.createPlan("deploy hyperlane core", undefined, cwd);

    expect(plan.commands.some((command) => /--chain\s+sepolia/i.test(command))).toBe(false);
    expect(plan.commands.some((command) => /hyperlane core read/i.test(command))).toBe(false);
    expect(plan.commands).toContain("hyperlane registry list --registry .");
  });

  test("uses inferred chain from local registry when mentioned in goal", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ops-agent-fallback-"));
    mkdirSync(join(cwd, "chains", "evolve1"), { recursive: true });
    writeFileSync(join(cwd, "chains", "evolve1", "metadata.yaml"), "protocol: ethereum\n", "utf8");
    const engine = new FallbackDecisionEngine();

    const plan = await engine.createPlan("deploy hyperlane core on evolve1", undefined, cwd);

    expect(plan.commands).toContain(
      "hyperlane core read --chain evolve1 --config configs/evolve1-core.yaml --registry .",
    );
  });
});
