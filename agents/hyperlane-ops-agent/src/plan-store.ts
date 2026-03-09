import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { ApprovalRecord, PlanRecord, RunEvent, RunRecord, RunStatus } from "./types.js";

interface StoreData {
  plans: Record<string, PlanRecord>;
  approvals: Record<string, ApprovalRecord>;
  runs: Record<string, RunRecord>;
}

const EMPTY_STORE: StoreData = {
  plans: {},
  approvals: {},
  runs: {},
};

function nowIso(): string {
  return new Date().toISOString();
}

export class PlanStore {
  constructor(private readonly filePath: string) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    if (!this.exists()) {
      this.write(EMPTY_STORE);
    }
  }

  createPlan(record: Omit<PlanRecord, "id" | "createdAt">): PlanRecord {
    const data = this.read();
    const id = randomUUID();
    const plan: PlanRecord = {
      ...record,
      id,
      createdAt: nowIso(),
    };

    data.plans[id] = plan;
    this.write(data);
    return plan;
  }

  getPlan(planId: string): PlanRecord | undefined {
    return this.read().plans[planId];
  }

  createApproval(planId: string, commandHashes: string[], ttlSeconds: number): ApprovalRecord {
    const data = this.read();
    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    const approval: ApprovalRecord = {
      token,
      planId,
      commandHashes,
      expiresAt,
      consumed: false,
      createdAt: nowIso(),
    };

    data.approvals[token] = approval;
    this.write(data);
    return approval;
  }

  consumeApproval(planId: string, token: string): ApprovalRecord {
    const data = this.read();
    const approval = data.approvals[token];

    if (!approval) {
      throw new Error("Approval token not found");
    }
    if (approval.planId !== planId) {
      throw new Error("Approval token does not match plan");
    }
    if (approval.consumed) {
      throw new Error("Approval token already consumed");
    }
    if (new Date(approval.expiresAt).getTime() < Date.now()) {
      throw new Error("Approval token expired");
    }

    approval.consumed = true;
    data.approvals[token] = approval;
    this.write(data);
    return approval;
  }

  createRun(planId: string): RunRecord {
    const data = this.read();
    const id = randomUUID();
    const run: RunRecord = {
      id,
      planId,
      status: "pending",
      createdAt: nowIso(),
      transcript: [],
      commands: [],
    };

    data.runs[id] = run;
    this.write(data);
    return run;
  }

  updateRun(runId: string, updater: (run: RunRecord) => void): RunRecord {
    const data = this.read();
    const run = data.runs[runId];
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    updater(run);
    data.runs[runId] = run;
    this.write(data);
    return run;
  }

  appendRunEvent(runId: string, event: RunEvent): void {
    this.updateRun(runId, (run) => {
      run.transcript.push(event);
    });
  }

  setRunStatus(runId: string, status: RunStatus): RunRecord {
    return this.updateRun(runId, (run) => {
      run.status = status;
      if (status === "running" && !run.startedAt) {
        run.startedAt = nowIso();
      }
      if ((status === "failed" || status === "completed") && !run.finishedAt) {
        run.finishedAt = nowIso();
      }
    });
  }

  getRun(runId: string): RunRecord | undefined {
    return this.read().runs[runId];
  }

  private exists(): boolean {
    try {
      readFileSync(this.filePath, "utf8");
      return true;
    } catch {
      return false;
    }
  }

  private read(): StoreData {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      return JSON.parse(raw) as StoreData;
    } catch {
      return { ...EMPTY_STORE };
    }
  }

  private write(data: StoreData): void {
    writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
}
