import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { PlanStore } from "../src/plan-store.js";

describe("plan-store approvals", () => {
  test("consumes valid token once", () => {
    const dir = mkdtempSync(join(tmpdir(), "ops-agent-store-"));
    const store = new PlanStore(join(dir, "store.json"));

    const plan = store.createPlan({
      goal: "test",
      summary: "summary",
      context: "ctx",
      cwd: process.cwd(),
      commands: [
        {
          hash: "h1",
          command: "docker compose ps",
          class: "read",
          reason: "read",
        },
      ],
    });

    const approval = store.createApproval(plan.id, ["h1"], 600);
    const consumed = store.consumeApproval(plan.id, approval.token);

    expect(consumed.consumed).toBe(true);
    expect(() => store.consumeApproval(plan.id, approval.token)).toThrow(/already consumed/);
  });
});
