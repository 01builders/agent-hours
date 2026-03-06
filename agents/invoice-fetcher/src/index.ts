import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

// Load .env file if present
const envPath = path.resolve(import.meta.dirname, "../.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const val = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}
import { ConfigSchema } from "./types.js";
import type { CLIOptions } from "./types.js";
import { initBrowser, closeBrowser } from "./tools/browser.js";
import { runAgent } from "./agent.js";

function parseArgs(argv: string[]): CLIOptions {
  const opts: CLIOptions = {
    fullSync: false,
    services: [],
    upload: false,
    headless: false,
    dryRun: false,
    configPath: "./config.yaml",
    login: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--full-sync":
        opts.fullSync = true;
        break;
      case "--services":
        opts.services = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--upload":
        opts.upload = true;
        break;
      case "--headless":
        opts.headless = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--config":
        opts.configPath = argv[++i] ?? opts.configPath;
        break;
      case "--login":
        opts.login = true;
        break;
      case "--help":
      case "-h":
        console.log(`Usage: npx tsx src/index.ts [options]

Options:
  --full-sync        Download ALL invoices, not just new ones
  --services <list>  Comma-separated service keys (default: all in config)
  --upload           Upload to Google Drive after download
  --headless         Run browser in headless mode
  --dry-run          List invoices without downloading
  --config <path>    Config file path (default: ./config.yaml)
  --login            Open browser for manual login, then exit
  -h, --help         Show this help message`);
        process.exit(0);
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv);

  const configPath = path.resolve(opts.configPath);
  if (!fs.existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = parseYaml(raw);
  const config = ConfigSchema.parse(parsed);

  // Resolve relative paths
  config.downloadsDir = path.resolve(path.dirname(configPath), config.downloadsDir);
  config.chromeProfileDir = path.resolve(path.dirname(configPath), config.chromeProfileDir);
  fs.mkdirSync(config.downloadsDir, { recursive: true });

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  // Login mode: open browser for manual login then wait
  if (opts.login) {
    console.log("Opening browser for manual login...");
    console.log("Log into your services, then press Ctrl+C to exit.");
    const sh = await initBrowser(config, false);
    const page = sh.context.pages()[0];
    const serviceKeys = opts.services.length > 0 ? opts.services : Object.keys(config.services);
    const first = config.services[serviceKeys[0]];
    if (first) {
      await page.goto(first.billingUrl);
      console.log(`Navigated to ${first.name}: ${first.billingUrl}`);
      console.log(`Other services to log into: ${serviceKeys.slice(1).join(", ")}`);
    }
    // Keep alive until Ctrl+C
    await new Promise(() => {});
  }

  try {
    await initBrowser(config, opts.headless);
    await runAgent(config, opts);
  } finally {
    await closeBrowser();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
