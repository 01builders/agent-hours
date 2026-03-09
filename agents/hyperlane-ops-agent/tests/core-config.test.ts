import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { normalizeCoreCommandConfig, prepareCoreDeployCommand } from "../src/core-config.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("core config helpers", () => {
  test("normalizeCoreCommandConfig adds chain-specific config when missing", () => {
    const normalized = normalizeCoreCommandConfig("hyperlane core deploy --registry . --chain evolve1");
    expect(normalized.command).toContain("--config configs/evolve1-core.yaml");
    expect(normalized.changed).toBe(true);
  });

  test("normalizeCoreCommandConfig rewrites example config path", () => {
    const normalized = normalizeCoreCommandConfig(
      "hyperlane core deploy --registry . --chain evolve1 --config configs/core-config.example.yaml",
    );
    expect(normalized.command).toContain("--config configs/evolve1-core.yaml");
    expect(normalized.command).not.toContain("core-config.example.yaml");
  });

  test("prepareCoreDeployCommand creates config and rewrites owner fields", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ops-agent-core-config-"));
    mkdirSync(join(cwd, "configs"), { recursive: true });
    mkdirSync(join(cwd, "chains", "evolve1"), { recursive: true });

    writeFileSync(
      join(cwd, "configs", "core-config.example.yaml"),
      [
        'defaultHook:',
        '  beneficiary: "0x0000000000000000000000000000000000000001"',
        '  owner: "0x0000000000000000000000000000000000000002"',
        'owner: "0x0000000000000000000000000000000000000003"',
        'proxyAdmin:',
        '  owner: "0x0000000000000000000000000000000000000004"',
        "",
      ].join("\n"),
      "utf8",
    );

    writeFileSync(join(cwd, "chains", "evolve1", "metadata.yaml"), "protocol: ethereum\n", "utf8");
    process.env.HYP_KEY = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const ownerAddress = "0x1111111111111111111111111111111111111111";

    const prepared = prepareCoreDeployCommand("hyperlane core deploy --registry . --chain evolve1", cwd, {
      resolveOwnerAddress: () => ownerAddress,
    });

    expect(prepared.command).toContain("--config configs/evolve1-core.yaml");
    const generated = readFileSync(join(cwd, "configs", "evolve1-core.yaml"), "utf8");
    expect(generated).toContain(`beneficiary: "${ownerAddress}"`);
    expect(generated).toContain(`owner: "${ownerAddress}"`);
  });
});
