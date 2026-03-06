import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { getStagehand } from "./browser.js";

async function waitForNewFile(
  dir: string,
  before: Set<string>,
  timeoutMs = 30000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = fs.readdirSync(dir);
    const newFile = files.find(
      (f) => !before.has(f) && !f.endsWith(".crdownload") && !f.endsWith(".tmp"),
    );
    if (newFile) return newFile;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

export function createDownloadTool(downloadsDir: string) {
  return tool(
    "download_invoice",
    "Download a specific invoice by clicking the download button/link on the current page",
    {
      service: z.string().describe("Service key (e.g. 'anthropic-api')"),
      invoiceId: z.string().describe("Invoice ID to download"),
      invoiceDate: z.string().describe("Invoice date in YYYY-MM-DD format (e.g. '2025-01-15')"),
      downloadHint: z.string().describe("Natural language instruction to trigger the download"),
    },
    async (args) => {
      const sh = getStagehand();
      const absDir = path.resolve(downloadsDir);
      fs.mkdirSync(absDir, { recursive: true });

      const before = new Set(fs.readdirSync(absDir));

      const actResult = await sh.act(args.downloadHint);
      if (!actResult.success) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              message: `Failed to trigger download: ${actResult.message}`,
            }),
          }],
          isError: true,
        };
      }

      const newFile = await waitForNewFile(absDir, before);
      if (!newFile) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              message: "Download timed out — no new file appeared in 30s",
            }),
          }],
          isError: true,
        };
      }

      // Naming format: YYYY-MM-DD_service-key_invoice-id.ext
      const safeId = args.invoiceId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const safeDate = args.invoiceDate.replace(/[^0-9-]/g, "");
      const ext = path.extname(newFile) || ".pdf";
      const safeName = `${safeDate}_${args.service}_${safeId}${ext}`;
      const oldPath = path.join(absDir, newFile);
      const newPath = path.join(absDir, safeName);

      if (oldPath !== newPath) {
        fs.renameSync(oldPath, newPath);
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            filename: safeName,
            path: newPath,
          }, null, 2),
        }],
      };
    },
  );
}
