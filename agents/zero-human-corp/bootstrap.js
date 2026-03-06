#!/usr/bin/env node
/**
 * ZHC Paperclip Bootstrap
 *
 * Provisions Zero Human Corp inside a running Paperclip instance:
 *   1. Create company "Zero Human Corp"
 *   2. Register all 6 agents with claude_local adapter
 *   3. Create company goal + ZHC project + workspace
 *   4. Seed Duke's first task (strategic planning boot)
 *
 * Usage:
 *   node bootstrap.js
 *
 * Re-runnable: checks if company already exists before creating.
 */

import path from "path";
import { fileURLToPath } from "url";

const BASE_URL = process.env.PAPERCLIP_URL || "http://localhost:3100";
const ZHC_ROOT = process.env.ZHC_ROOT || path.dirname(fileURLToPath(import.meta.url));

async function api(method, endpoint, body) {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${endpoint} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function waitForPaperclip(maxAttempts = 20) {
  console.log(`Waiting for Paperclip at ${BASE_URL}...`);
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await fetch(`${BASE_URL}/api/health`);
      console.log("Paperclip is up.");
      return;
    } catch {
      process.stdout.write(".");
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error("Paperclip did not start in time.");
}

async function main() {
  await waitForPaperclip();

  // --- Company ---
  const companies = await api("GET", "/api/companies");
  let company = companies.find((c) => c.name === "Zero Human Corp");
  if (company) {
    console.log(`Company already exists: ${company.id}`);
  } else {
    company = await api("POST", "/api/companies", {
      name: "Zero Human Corp",
      description: "Fully autonomous AI company. Zero humans. 100% agents.",
      budgetMonthlyCents: 10000, // $100/month starting budget
    });
    console.log(`Created company: ${company.id}`);
  }
  const companyId = company.id;

  // --- Agents ---
  const existingAgents = await api("GET", `/api/companies/${companyId}/agents`);
  const byName = Object.fromEntries(existingAgents.map((a) => [a.name, a]));

  const agentDefs = [
    {
      name: "Duke",
      role: "ceo",
      title: "CEO — Champion",
      capabilities: "Strategic planning, delegation, revenue discovery, agent orchestration",
      model: "claude-opus-4-6",
      dir: "ceo",
      permissions: { canCreateAgents: true },
    },
    {
      name: "Hackerman",
      role: "cto",
      title: "CTO — Tech Lead",
      capabilities: "Code generation, architecture, Cloudflare deployment, debugging",
      model: "claude-opus-4-6",
      dir: "cto",
    },
    {
      name: "Borat",
      role: "researcher",
      title: "BizDev — Dealmaker",
      capabilities: "Market research, outreach, pre-selling, revenue generation",
      model: "claude-opus-4-6",
      dir: "bizdev",
    },
    {
      name: "T-800",
      role: "devops",
      title: "Ops — Operations Lead",
      capabilities: "Agent health monitoring, cost tracking, P&L reporting, self-healing",
      model: "claude-opus-4-6",
      dir: "ops",
    },
    {
      name: "DonDraper",
      role: "general",
      title: "Content — Marketing Lead",
      capabilities: "Copywriting, SEO, newsletters, social media, landing page copy",
      model: "claude-opus-4-6",
      dir: "content",
    },
    {
      name: "Picasso",
      role: "designer",
      title: "Designer — UI/UX",
      capabilities: "Landing pages, UI components, Tailwind, SVG graphics, Cloudflare Pages",
      model: "claude-opus-4-6",
      dir: "designer",
    },
  ];

  const createdAgents = {};
  let dukeId = byName["Duke"]?.id;

  // Create Duke first so others can reportsTo him
  for (const def of agentDefs) {
    if (byName[def.name]) {
      console.log(`Agent exists: ${def.name} (${byName[def.name].id})`);
      createdAgents[def.name] = byName[def.name];
      if (def.name === "Duke") dukeId = byName[def.name].id;
      continue;
    }

    const reportsTo = def.name !== "Duke" && dukeId ? dukeId : null;
    const agent = await api("POST", `/api/companies/${companyId}/agents`, {
      name: def.name,
      role: def.role,
      title: def.title,
      capabilities: def.capabilities,
      adapterType: "claude_local",
      adapterConfig: {
        model: def.model,
        cwd: ZHC_ROOT,
        instructionsFilePath: path.join(ZHC_ROOT, "agents", def.dir, "system-prompt.md"),
        dangerouslySkipPermissions: true,
        maxTurnsPerRun: 50,
        timeoutSec: 3600,
      },
      budgetMonthlyCents: def.name === "Duke" ? 5000 : 3000, // Duke $50, others $30/mo
      permissions: def.permissions,
      reportsTo,
    });
    console.log(`Created agent: ${agent.name} (${agent.id})`);
    createdAgents[def.name] = agent;
    if (def.name === "Duke") dukeId = agent.id;
  }

  // --- Goal ---
  const goals = await api("GET", `/api/companies/${companyId}/goals`);
  let goal = goals.find((g) => g.title === "Build profitable business from $0");
  if (goal) {
    console.log(`Goal exists: ${goal.id}`);
  } else {
    goal = await api("POST", `/api/companies/${companyId}/goals`, {
      title: "Build profitable business from $0",
      description:
        "Operate Zero Human Corp as a fully autonomous AI company. Identify revenue opportunities, build products, close deals, and reach profitability — all without human intervention.",
      level: "company",
      status: "active",
      ownerAgentId: createdAgents["Duke"]?.id || dukeId,
    });
    console.log(`Created goal: ${goal.id}`);
  }

  // --- Project ---
  const projects = await api("GET", `/api/companies/${companyId}/projects`);
  let project = projects.find((p) => p.name === "ZHC Revenue Engine");
  if (project) {
    console.log(`Project exists: ${project.id}`);
  } else {
    project = await api("POST", `/api/companies/${companyId}/projects`, {
      name: "ZHC Revenue Engine",
      description: "All revenue-generating work: product discovery, MVP builds, sales, marketing.",
      status: "in_progress",
      goalIds: [goal.id],
      workspace: {
        name: "zero-human-corp",
        cwd: ZHC_ROOT,
        isPrimary: true,
      },
    });
    console.log(`Created project: ${project.id}`);
  }

  // --- Duke's first task ---
  const issues = await api(
    "GET",
    `/api/companies/${companyId}/issues?assigneeAgentId=${dukeId}&status=todo,in_progress,blocked`,
  );
  if (issues.length > 0) {
    console.log(`Duke already has ${issues.length} task(s). Skipping seed.`);
  } else {
    const task = await api("POST", `/api/companies/${companyId}/issues`, {
      title: "Boot: Strategic Planning — Scan for first revenue opportunity",
      description: `You are Duke, CEO of Zero Human Corp. This is your first task.

**Objective:** Identify the highest-signal revenue opportunity ZHC can pursue in the next 48 hours.

**Steps:**
1. Review \`memory/company-state.md\` and \`economy/budget.json\` for current state
2. Use WebSearch to research 3–5 micro-market revenue opportunities
3. Score each using the Decision Framework (TAM / Speed / Revenue Path / Moat / AI Fit)
4. Select the top opportunity (score ≥ 15)
5. Create tasks for Hackerman (build), Borat (outreach/pre-sell), Don Draper (copy), Picasso (landing page)
6. Update \`memory/company-state.md\` with your strategy

**Constraints:**
- Ship something in < 4 hours
- No commodity plays (chatbots, Upwork)
- Subscription > one-time revenue`,
      assigneeAgentId: dukeId,
      projectId: project.id,
      goalId: goal.id,
      status: "todo",
      priority: "critical",
    });
    console.log(`Seeded Duke's first task: ${task.id}`);
  }

  console.log(`
=== ZHC Bootstrap Complete ===
Company:    ${companyId}
Goal:       ${goal.id}
Project:    ${project.id}
Agents:     ${Object.entries(createdAgents).map(([n, a]) => `${n}=${a.id}`).join(", ")}

Next steps:
  1. Open Paperclip: ${BASE_URL}
  2. Wake Duke:  POST ${BASE_URL}/api/agents/${dukeId}/wakeup
     or click "Wake" on Duke's agent page in the Paperclip UI
`);
}

main().catch((err) => {
  console.error("Bootstrap failed:", err.message);
  process.exit(1);
});
