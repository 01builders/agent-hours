import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { checkLogin, browseBilling, listInvoices } from "./tools/browser.js";
import { createDownloadTool } from "./tools/download.js";
import { uploadToDrive } from "./tools/drive.js";
import { readManifest, saveManifest } from "./tools/manifest.js";
import type { Config, CLIOptions } from "./types.js";

// Allow running inside an existing Claude Code session
delete process.env.CLAUDECODE;

const SYSTEM_PROMPT = `You are an invoice-fetching agent. Your job is to download invoices from SaaS billing portals and optionally upload them to Google Drive.

You have tools for browser automation, file downloads, and Drive uploads.

Workflow for each service:
1. Call check_login to verify session is active
2. If not logged in: report it and skip (user must log in manually first)
3. Call browse_billing to navigate to the invoices page
4. Call list_invoices to extract available invoices
5. Call read_manifest to check which invoices are already downloaded
6. For each new invoice (or all if fullSync=true), call download_invoice
7. Call save_manifest after each successful download
8. If upload=true, call upload_to_drive for each new file

IMPORTANT — File naming convention:
- When calling download_invoice, always pass invoiceDate in YYYY-MM-DD format
- Downloaded files will be named: YYYY-MM-DD_service-key_invoice-id.pdf
  Example: 2025-01-15_anthropic-api_INV-1234.pdf
- When calling upload_to_drive, use the same filename so Drive matches local files
- If the invoice date is ambiguous (e.g. "Jan 2025"), use the first of the month: 2025-01-01

Handle errors gracefully: if a service fails, log the error and continue to the next service. Never retry more than once.

If dryRun=true, list invoices without downloading — just report what would be downloaded.

Report a summary at the end: services processed, invoices downloaded, invoices uploaded, errors encountered.`;

export async function runAgent(config: Config, options: CLIOptions): Promise<void> {
  const serviceKeys = options.services.length > 0
    ? options.services
    : Object.keys(config.services);

  const serviceDescriptions = serviceKeys.map((key) => {
    const svc = config.services[key];
    if (!svc) return `- ${key}: NOT FOUND IN CONFIG`;
    return `- ${key}: ${svc.name} (${svc.billingUrl})
    loginCheck: "${svc.loginCheck}"
    navigate hint: "${svc.hints.navigate}"
    extract hint: "${svc.hints.extract}"
    download hint: "${svc.hints.download}"`;
  }).join("\n");

  const userPrompt = `Process these services:
${serviceDescriptions}

Options:
- fullSync: ${options.fullSync}
- upload: ${options.upload}
- dryRun: ${options.dryRun}
- driveFolderId: ${config.driveFolderId || "(not configured)"}

Downloads directory: ${config.downloadsDir}`;

  const invoiceTools = createSdkMcpServer({
    name: "invoice-tools",
    tools: [
      checkLogin,
      browseBilling,
      listInvoices,
      createDownloadTool(config.downloadsDir),
      uploadToDrive,
      readManifest,
      saveManifest,
    ],
  });

  for await (const message of query({
    prompt: userPrompt,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      mcpServers: { "invoice-tools": invoiceTools },
      allowedTools: ["mcp__invoice-tools__*"],
      permissionMode: "bypassPermissions",
      maxTurns: 100,
    },
  })) {
    if (message.type === "assistant" && message.message?.content) {
      for (const block of message.message.content) {
        if ("text" in block && block.text) {
          process.stdout.write(block.text + "\n");
        }
      }
    }

    if (message.type === "result") {
      if (message.subtype === "success") {
        console.log("\n--- Agent completed ---");
        if (message.result) console.log(message.result);
      } else {
        console.error("\n--- Agent error ---");
        console.error(message);
      }
    }
  }
}
