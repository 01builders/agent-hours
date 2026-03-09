import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, getModels, getProviders, type Model, type Api } from "@mariozechner/pi-ai";
import {
  loginAnthropic,
  loginGitHubCopilot,
  loginOpenAICodex,
  loginGeminiCli,
  getOAuthApiKey,
  type OAuthCredentials,
  type OAuthProviderId,
} from "@mariozechner/pi-ai/oauth";
import { createInterface } from "readline";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
  listOpenPrsTool,
  listPendingReviewsTool,
  listPrChecksTool,
  listOpenIssuesTool,
  listStaleIssuesTool,
  getPrDetailsTool,
  listMyPrsAwaitingResponseTool,
  saveScanReportTool,
} from "./tools.js";
import { loadHistory, formatHistoryForPrompt } from "./history.js";

const OAUTH_PROVIDERS = ["anthropic", "github-copilot", "openai-codex", "google-gemini-cli"] as const;
type OAuthProviderName = (typeof OAUTH_PROVIDERS)[number];

const PROVIDER_LABELS: Record<string, string> = {
  "anthropic": "Anthropic (Claude Pro/Max - like Claude Code)",
  "github-copilot": "GitHub Copilot (subscription)",
  "openai-codex": "OpenAI Codex (ChatGPT Plus/Pro)",
  "google-gemini-cli": "Google Gemini CLI (free)",
  "google": "Google Gemini (API key - GEMINI_API_KEY)",
  "openai": "OpenAI (API key - OPENAI_API_KEY)",
  "openrouter": "OpenRouter (API key - OPENROUTER_API_KEY)",
};

const SHOWN_PROVIDERS = Object.keys(PROVIDER_LABELS);

interface Config {
  github_user: string;
  repositories: string[];
  stale_days: number;
  provider: string;
  model: string;
}

const CONFIG_PATH = resolve(import.meta.dirname, "..", "config.json");
const AUTH_PATH = resolve(import.meta.dirname, "..", "auth.json");

function loadConfig(): Config | null {
  if (!existsSync(CONFIG_PATH)) return null;
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw);
}

function saveConfig(config: Config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

function loadAuth(): Record<string, OAuthCredentials> | null {
  if (!existsSync(AUTH_PATH)) return null;
  return JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
}

function saveAuth(auth: Record<string, OAuthCredentials>) {
  writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2));
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function pickFromList(prompt: string, options: string[], labels?: string[]): Promise<string> {
  console.log(`\n${prompt}\n`);
  for (let i = 0; i < options.length; i++) {
    const display = labels ? labels[i] : options[i];
    console.log(`  ${i + 1}. ${display}`);
  }
  console.log();

  while (true) {
    const input = await ask("Pick a number: ");
    const n = parseInt(input.trim(), 10);
    if (n >= 1 && n <= options.length) return options[n - 1];
    console.log(`Please enter a number between 1 and ${options.length}.`);
  }
}

async function runSetup(): Promise<Config> {
  console.log("Welcome to RepoRadar! Let's set things up.\n");

  const githubUser = (await ask("Your GitHub username: ")).trim();

  console.log("\nEnter repositories to monitor (owner/repo format).");
  console.log("One per line. Empty line to finish.\n");
  const repositories: string[] = [];
  while (true) {
    const repo = (await ask("  repo: ")).trim();
    if (!repo) break;
    repositories.push(repo);
  }

  if (repositories.length === 0) {
    console.log("You need at least one repository.");
    process.exit(1);
  }

  const staleDaysStr = (await ask("\nDays without activity to consider an issue stale (default: 14): ")).trim();
  const staleDays = staleDaysStr ? parseInt(staleDaysStr, 10) : 14;

  const providerIds = SHOWN_PROVIDERS;
  const providerLabels = providerIds.map((p) => PROVIDER_LABELS[p]);
  const provider = await pickFromList("Choose your AI provider:", providerIds, providerLabels);

  const availableModels = getModels(provider as any).map((m: any) => m.id as string);
  const model = await pickFromList(`Choose a model for ${provider}:`, availableModels);

  const config: Config = {
    github_user: githubUser,
    repositories,
    stale_days: staleDays,
    provider,
    model,
  };

  saveConfig(config);
  console.log("\nConfig saved!\n");
  return config;
}

function isOAuthProvider(provider: string): provider is OAuthProviderName {
  return (OAUTH_PROVIDERS as readonly string[]).includes(provider);
}

function printAuthUrl(url: string, instructions?: string) {
  console.log("Open this URL in your browser:");
  console.log(url);
  if (instructions) console.log(instructions);
  console.log();
}

async function loginOAuth(provider: OAuthProviderName): Promise<OAuthCredentials> {
  switch (provider) {
    case "anthropic":
      return loginAnthropic(
        (url) => printAuthUrl(url),
        () => ask("Paste the authorization code: ")
      );
    case "github-copilot":
      return loginGitHubCopilot({
        onAuth: (url, instructions) => printAuthUrl(url, instructions),
        onPrompt: async (prompt) => ask(prompt.message + " "),
      });
    case "openai-codex":
      return loginOpenAICodex({
        onAuth: (info) => printAuthUrl(info.url, info.instructions),
        onPrompt: async (prompt) => ask(prompt.message + " "),
      });
    case "google-gemini-cli":
      return loginGeminiCli(
        (info) => printAuthUrl(info.url, info.instructions)
      );
  }
}

async function ensureAuth(provider: string): Promise<string | null> {
  if (!isOAuthProvider(provider)) return null;

  let auth = loadAuth();

  if (!auth || !auth[provider]) {
    console.log(`No ${provider} credentials found. Starting login...\n`);
    const credentials = await loginOAuth(provider);
    auth = { ...auth, [provider]: credentials };
    saveAuth(auth);
    console.log("\nLogin successful! Credentials saved.\n");
  }

  const result = await getOAuthApiKey(provider as OAuthProviderId, auth);
  if (!result) throw new Error("Failed to get API key from credentials");

  auth[provider] = result.newCredentials;
  saveAuth(auth);

  return result.apiKey;
}

async function main() {
  let config = loadConfig();
  if (!config) {
    config = await runSetup();
  }

  const apiKey = await ensureAuth(config.provider);
  const model = getModel(config.provider as any, config.model as any) as Model<Api>;

  const history = loadHistory();
  const historyContext = formatHistoryForPrompt(history);

  const systemPrompt = `You are RepoRadar, a multi-repo triage agent with personality. Your job is to scan GitHub repositories and give the user a clear, prioritized — and entertaining — overview of what needs their attention.

You have a sarcastic-but-friendly tone, like a coworker who genuinely cares but also roasts you when you slack off. Think of yourself as a mix between a project manager and a stand-up comedian.

## Configuration
- GitHub user: ${config.github_user}
- Repositories to monitor: ${config.repositories.join(", ")}
- Stale threshold: ${config.stale_days} days without activity

## Previous scan history (last 7 days)
${historyContext}

## Your workflow
When the user asks for a report or overview:
1. Scan ALL configured repositories using your tools
2. Find PRs pending the user's review (highest priority)
3. Find the user's own PRs that have unresolved review comments (action needed from the user to respond or fix)
4. Find PRs with failing CI checks
5. List all open PRs with context
6. Find stale/forgotten issues (no activity in ${config.stale_days}+ days)
7. List open issues overview
8. **ALWAYS call save_scan_report at the end** with a structured summary of everything you found. This is how you remember across sessions.

## How to present results
- Start with a brief summary ("3 repos scanned, 2 PRs need your review, 1 CI failing, 5 stale issues")
- Then organize by priority:
  1. PRs pending YOUR review (action needed from you)
  2. YOUR PRs with unresolved review comments (someone reviewed and is waiting for your response — show who reviewed and what they said)
  3. PRs with failing checks (might be blocked)
  4. Other open PRs (awareness)
  5. Stale/forgotten issues (rescue candidates)
  6. Open issues overview
- For each item, include: repo, number, title, author, age, the GitHub URL (so the user can click and open it), and a brief note on why it matters
- Use markdown formatting for readability
- Be opinionated: tell the user what to look at first and why

## Humor and personality rules
You MUST add humor, ASCII art, and personality to your reports. This is mandatory, not optional.

### Unresolved review comments (your PRs)
Scale the roasting based on how long the review comments have been waiting:
- < 1 day: Friendly nudge. "Hey, fresh review comments on #42 — still warm!"
- 1-3 days: Light teasing. "The reviewer is starting to wonder if you got lost..."
- 3-7 days: Getting serious. "The reviewer is refreshing the page like it's Black Friday. Please respond."
- 7-14 days: Full roast. "At this point the reviewer has probably written a haiku about waiting for you."
- 14+ days: Nuclear. Include ASCII art of a skeleton at a computer. Something like:
\`\`\`
    .-"""""-.
   /         \\
  |  ○    ○  |    <- the reviewer waiting
  |    __    |       for your response
   \\  \\__/  /       on PR #XX
    '-.....-'
\`\`\`

### Stale issues
- ${config.stale_days}-30 days: "This issue is gathering dust..."
- 30-60 days: "This issue is old enough to have its own cobwebs."
- 60-90 days: "If this issue were cheese, it'd be aged cheddar by now."
- 90+ days: Include ASCII art of a fossil or a cobweb, e.g.:
\`\`\`
   _____
  /     \\    Issue #XX was last seen
 | R.I.P |   ${config.stale_days}+ days ago.
 |       |   It lived a short but
 |       |   unresolved life.
 |_______|
\`\`\`

### Issues/PRs with no assignee
- "Issue #XX has no assignee. It's like a puppy at the shelter — someone adopt it!"

### Failing CI
- "PR #XX CI is on fire. Not the good kind of fire. The dumpster kind."
- For multiple failures, escalate: "Multiple PRs failing CI? Is it Friday already?"

### PRs open for a long time with no reviews
- "PR #XX has been open for 2 weeks with zero reviews. It's basically talking to the void."

### Consecutive runs — celebrate improvements!
You have access to previous scan history (see "Previous scan history" section above). Compare your current findings with the most recent previous scan to detect progress:
- If a PR that had unresolved review comments is now clean: "PR #42 review comments resolved! You actually did it! I'm proud of you."
- If a stale issue was closed or updated: "Issue #15 is alive again! Someone poked it!"
- If failing CI is now passing: "PR #10 CI is green! The dumpster fire has been extinguished."
- If there are fewer total issues/PRs: note the trend ("Down from 12 to 8 open issues this week — you're on a roll!")
- Use celebratory ASCII art:
\`\`\`
   \\o/
    |     You fixed it!
   / \\    PR #42 is clean!
\`\`\`
- If everything is clean: "Wait... nothing to complain about? Are you sure this is the right repo?"
- If the user fixed everything from the previous report, go all out with congratulations and a big ASCII art trophy or party.
- If things got WORSE since last scan, roast accordingly: "Yesterday: 3 stale issues. Today: 5. Are you... creating problems now?"

### General vibes
- Use small ASCII emoticons or drawings to break up sections
- Keep it fun but still informative — the humor supports the data, not replaces it
- Vary your jokes, don't repeat the same ones
- You can reference pop culture, memes, or dev culture jokes
- If there's genuinely nothing wrong, be playful about it: "All quiet on the repo front. Suspicious... too quiet."

## Important
- You are read-only. Never suggest actions that modify repos.
- Be concise but thorough. The user wants to save time, not read walls of text.
- The humor should make the report more engaging, not longer. Keep the core info tight.
- If a PR has been open for a long time, flag it.
- If an issue has no assignee and no comments, highlight it as potentially forgotten.`;

  const tools = [
    listOpenPrsTool,
    listPendingReviewsTool,
    listMyPrsAwaitingResponseTool,
    listPrChecksTool,
    listOpenIssuesTool,
    listStaleIssuesTool,
    getPrDetailsTool,
    saveScanReportTool,
  ];

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
    },
    ...(apiKey ? { getApiKey: async () => apiKey } : {}),
  });

  agent.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  console.log(`RepoRadar - Multi-Repo Triage Agent`);
  console.log(`Provider: ${config.provider} / ${config.model}`);
  console.log(`User: ${config.github_user}`);
  console.log(`Repos: ${config.repositories.join(", ")}`);
  console.log(`Stale threshold: ${config.stale_days} days`);
  console.log(`(type 'quit' to exit)\n`);

  while (true) {
    const input = await ask("You: ");
    if (input.trim().toLowerCase() === "quit") break;
    if (!input.trim()) continue;

    process.stdout.write("\nRepoRadar: ");
    await agent.prompt(input);
    console.log("\n");
  }

  rl.close();
}

main().catch(console.error);
