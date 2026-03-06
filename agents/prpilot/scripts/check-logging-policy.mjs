#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED_DEBUG_FILES = [
  "src/main.ts",
  "src/agent/session-manager.ts",
  "src/agent/pi-runner.ts",
  "src/github/token-refresh.ts",
  "src/git/branch.ts",
  "src/git/commit.ts",
  "src/git/pr.ts",
  "src/utils/exec.ts",
];

const CONSOLE_PATTERN = /(^|[^\w])console\.(log|error|warn|info|debug)\s*\(/;

async function main() {
  const tsFiles = await listFiles(path.join(root, "src"), (file) => file.endsWith(".ts"));

  for (const file of tsFiles) {
    const rel = path.relative(root, file);
    const content = await fs.readFile(file, "utf8");

    if (CONSOLE_PATTERN.test(content)) {
      failures.push(`${rel}: console.* usage is forbidden, use logger`);
    }
  }

  for (const rel of REQUIRED_DEBUG_FILES) {
    const abs = path.join(root, rel);
    const content = await fs.readFile(abs, "utf8");
    if (!content.includes("logger.debug(")) {
      failures.push(`${rel}: missing required logger.debug() instrumentation`);
    }
  }

  await assertContains("src/config.ts", "LOG_LEVEL", "LOG_LEVEL env parsing missing in src/config.ts");
  await assertContains(".env.example", "LOG_LEVEL=", "LOG_LEVEL missing in .env.example");
  await assertContains("README.md", "LOG_LEVEL", "LOG_LEVEL documentation missing in README.md");

  if (failures.length > 0) {
    process.stderr.write("Logging policy check failed:\n");
    for (const failure of failures) {
      process.stderr.write(` - ${failure}\n`);
    }
    process.exit(1);
  }

  process.stdout.write("Logging policy check passed.\n");
}

async function assertContains(relPath, needle, message) {
  const content = await fs.readFile(path.join(root, relPath), "utf8");
  if (!content.includes(needle)) failures.push(message);
}

async function listFiles(dir, predicate) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath, predicate)));
    } else if (entry.isFile() && predicate(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

main().catch((error) => {
  process.stderr.write(`Logging policy check failed with exception: ${error.message}\n`);
  process.exit(1);
});
