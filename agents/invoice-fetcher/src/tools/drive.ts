import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { execSync } from "node:child_process";

export const uploadToDrive = tool(
  "upload_to_drive",
  "Upload a downloaded invoice file to Google Drive using gws CLI",
  {
    filePath: z.string().describe("Absolute path to the file to upload"),
    fileName: z.string().describe("Display name for the file in Drive"),
    folderId: z.string().describe("Google Drive folder ID to upload into"),
  },
  async (args) => {
    try {
      const metadata = JSON.stringify({
        name: args.fileName,
        parents: [args.folderId],
      });

      const result = execSync(
        `gws drive files create --json '${metadata}' --upload "${args.filePath}"`,
        {
          encoding: "utf-8",
          timeout: 60000,
          env: { ...process.env },
        },
      );

      const parsed = JSON.parse(result);
      const driveFileId = parsed.id ?? "unknown";

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ success: true, driveFileId, name: parsed.name }, null, 2),
        }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Upload failed: ${message}` }],
        isError: true,
      };
    }
  },
);
