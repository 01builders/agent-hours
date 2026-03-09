import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluatePipeline } from "../src/policy.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("policy", () => {
  test("allows read-only relayer checks", () => {
    const result = evaluatePipeline("docker compose ps", process.cwd());
    expect(result.class).toBe("read");
  });

  test("blocks hyperlane mutation missing --registry .", () => {
    process.env.HYP_KEY = "0xabc";
    const result = evaluatePipeline("hyperlane core deploy --chain sepolia --config configs/sepolia-core.yaml", process.cwd());
    expect(result.class).toBe("blocked");
    expect(result.reason).toContain("--registry .");
  });

  test("requires HYP_KEY for EVM mutating command", () => {
    delete process.env.HYP_KEY;
    const result = evaluatePipeline("cast send 0xabc \"foo()\"", process.cwd());
    expect(result.class).toBe("blocked");
    expect(result.reason).toContain("HYP_KEY");
  });

  test("marks write command when env and registry checks pass", () => {
    process.env.HYP_KEY = "0xabc";
    const repoRoot = join(process.cwd(), "..");
    const result = evaluatePipeline(
      "hyperlane core deploy --chain sepolia --config configs/sepolia-core.yaml --registry .",
      repoRoot,
    );
    expect(result.class).toBe("write");
  });

  test("blocks core deploy/apply missing --chain", () => {
    process.env.HYP_KEY = "0xabc";
    const result = evaluatePipeline("hyperlane core deploy --registry . --config configs/evolve1-core.yaml", process.cwd());
    expect(result.class).toBe("blocked");
    expect(result.reason).toContain("--chain");
  });

  test("blocks core deploy when chain metadata is missing", () => {
    process.env.HYP_KEY = "0xabc";
    const cwd = mkdtempSync(join(tmpdir(), "ops-agent-policy-"));
    const result = evaluatePipeline(
      "hyperlane core deploy --chain evolve1 --config configs/evolve1-core.yaml --registry .",
      cwd,
    );
    expect(result.class).toBe("blocked");
    expect(result.reason).toContain("Chain metadata is missing");
    expect(result.remediation).toContain("ops-agent add-chain");
  });
});
