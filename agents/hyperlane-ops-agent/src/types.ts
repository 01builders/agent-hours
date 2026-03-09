export type CommandClass = "read" | "write" | "blocked";

export interface PlannedCommand {
  hash: string;
  command: string;
  class: CommandClass;
  reason: string;
  remediation?: string;
}

export interface PlanRecord {
  id: string;
  goal: string;
  context?: string;
  cwd: string;
  summary: string;
  commands: PlannedCommand[];
  createdAt: string;
}

export interface ApprovalRecord {
  token: string;
  planId: string;
  commandHashes: string[];
  expiresAt: string;
  consumed: boolean;
  createdAt: string;
}

export type RunStatus = "pending" | "running" | "failed" | "completed";

export interface RunEvent {
  at: string;
  kind: "command" | "output" | "error" | "status";
  message: string;
  commandHash?: string;
}

export interface RunCommandResult {
  hash: string;
  command: string;
  class: CommandClass;
  status: "skipped" | "blocked" | "executed" | "failed";
  exitCode?: number;
  reason?: string;
}

export interface RunRecord {
  id: string;
  planId: string;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  commands: RunCommandResult[];
  transcript: RunEvent[];
}

export interface DecisionPlan {
  summary: string;
  commands: string[];
  rawResponse?: string;
}

export interface DecisionEngine {
  createPlan(goal: string, context: string | undefined, cwd: string): Promise<DecisionPlan>;
}

export interface PolicyEvaluation {
  class: CommandClass;
  reason: string;
  remediation?: string;
  requiresApproval: boolean;
}

export interface ExecuteOptions {
  approvalToken?: string;
  readOnly?: boolean;
}
