import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { Octokit } from "@octokit/rest";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { loadConfig } from "./config.js";
import { loadState, saveState, getEffectiveSince } from "./state.js";
import { loadSkills } from "./skills.js";
import { makeListPrsTool } from "./tools/list-prs.js";
import { makeGetPrDiffTool } from "./tools/get-pr-diff.js";
import { makeCreateDraftPrTool } from "./tools/create-draft-pr.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const STATE_PATH = path.join(ROOT, "state.json");

async function main(): Promise<void> {
    // 1. Config, state & timestamps
    const config = loadConfig();
    const state = loadState(STATE_PATH);
    const since = getEffectiveSince(state);
    const today = new Date().toISOString().slice(0, 10);

    console.log(`[refactoring-agent] Reviewing PRs since ${since}`);

    // 2. Build system prompt (inject skills + repo name)
    const skillsDir = path.join(ROOT, "skills");
    const skillsContext = loadSkills(skillsDir);
    const systemTemplate = fs.readFileSync(path.join(ROOT, "prompts", "system.md"), "utf-8");
    const systemPrompt = systemTemplate
        .replace("{SKILLS}", skillsContext || "(no skill files loaded)")
        .replace("{REPO}", `${config.repoOwner}/${config.repoName}`)
        .replace("{DATE}", today);

    // 3. Model — gemini-3-flash-preview is the closest available in this version
    const model = getModel("google", "gemini-2.5-flash");

    // 4. GitHub tools (factory functions close over octokit + repo coords + since)
    const octokit = new Octokit({ auth: config.githubToken });
    const defaultBranch = process.env.BASE_BRANCH ?? "main";
    const tools = [
        makeListPrsTool(octokit, config.repoOwner, config.repoName, since),
        makeGetPrDiffTool(octokit, config.repoOwner, config.repoName),
        makeCreateDraftPrTool(octokit, config.repoOwner, config.repoName, defaultBranch),
    ];

    // 5. Create agent
    const agent = new Agent();
    agent.setSystemPrompt(systemPrompt);
    agent.setModel(model);
    agent.setTools(tools);
    agent.getApiKey = () => config.geminiApiKey;

    // 6. Log lifecycle events
    agent.subscribe((event) => {
        switch (event.type) {
            case "agent_start":
                console.log("[agent] Starting...");
                break;
            case "turn_start":
                console.log("[agent] LLM turn...");
                break;
            case "tool_execution_start":
                console.log(`[tool→] ${event.toolName}`);
                break;
            case "tool_execution_end":
                if (event.isError) console.error(`[tool✗] ${event.toolName}: error`);
                else console.log(`[tool✓] ${event.toolName}`);
                break;
            case "agent_end":
                console.log(`[agent] Finished (${String(event.messages.length)} messages).`);
                break;
        }
    });

    // 7. Run the agent with an initial user prompt
    const branchName = `refactoring-suggestions-${today}`;
    await agent.prompt(
        `Review merged PRs for ${config.repoOwner}/${config.repoName} since ${since}, fetch their diffs, then open a draft PR titled "refactor: Suggestions ${today}" on branch "${branchName}".`
    );
    // No waitForIdle() needed — agent.prompt() completes the full run

    // 8. Persist updated state
    saveState(STATE_PATH, { lastRunAt: new Date().toISOString() });
    console.log("[refactoring-agent] Done — state updated.");
}

main().catch((err: unknown) => {
    console.error("[refactoring-agent] Fatal:", err);
    process.exit(1);
});
