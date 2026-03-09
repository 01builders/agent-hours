import { Counter, Registry, collectDefaultMetrics } from "prom-client";

export interface AgentMetrics {
  registry: Registry;
  plansCreatedTotal: Counter<string>;
  writesBlockedTotal: Counter<string>;
  writesExecutedTotal: Counter<string>;
  policyViolationTotal: Counter<string>;
  runFailuresTotal: Counter<string>;
}

export function createMetrics(): AgentMetrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: "ops_agent_" });

  const plansCreatedTotal = new Counter({
    name: "plans_created_total",
    help: "Total number of plans created",
    registers: [registry],
  });

  const writesBlockedTotal = new Counter({
    name: "writes_blocked_total",
    help: "Total number of blocked mutating commands",
    registers: [registry],
  });

  const writesExecutedTotal = new Counter({
    name: "writes_executed_total",
    help: "Total number of executed mutating commands",
    registers: [registry],
  });

  const policyViolationTotal = new Counter({
    name: "policy_violation_total",
    help: "Total number of policy violations",
    registers: [registry],
  });

  const runFailuresTotal = new Counter({
    name: "run_failures_total",
    help: "Total number of failed runs",
    registers: [registry],
  });

  return {
    registry,
    plansCreatedTotal,
    writesBlockedTotal,
    writesExecutedTotal,
    policyViolationTotal,
    runFailuresTotal,
  };
}
