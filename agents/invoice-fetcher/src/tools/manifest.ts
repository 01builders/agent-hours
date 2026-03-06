import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

const MANIFEST_PATH = path.resolve("data/manifest.json");

function ensureManifest(): void {
  if (!fs.existsSync(MANIFEST_PATH)) {
    fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ invoices: [] }, null, 2));
  }
}

export const readManifest = tool(
  "read_manifest",
  "Read the invoice manifest to check which invoices have already been downloaded",
  {
    service: z.string().optional().describe("Filter by service name. Omit to get all."),
  },
  async (args) => {
    ensureManifest();
    const raw = fs.readFileSync(MANIFEST_PATH, "utf-8");
    const manifest = JSON.parse(raw);
    const invoices = args.service
      ? manifest.invoices.filter((i: { service: string }) => i.service === args.service)
      : manifest.invoices;
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ invoices }, null, 2) }],
    };
  },
);

export const saveManifest = tool(
  "save_manifest",
  "Save a new invoice entry to the manifest after downloading",
  {
    service: z.string().describe("Service key (e.g. 'anthropic')"),
    id: z.string().describe("Invoice ID"),
    date: z.string().describe("Invoice date"),
    amount: z.string().describe("Invoice amount"),
    filename: z.string().describe("Downloaded filename"),
    uploaded: z.boolean().optional().describe("Whether uploaded to Drive"),
  },
  async (args) => {
    ensureManifest();
    const raw = fs.readFileSync(MANIFEST_PATH, "utf-8");
    const manifest = JSON.parse(raw);

    const exists = manifest.invoices.some(
      (i: { service: string; id: string }) => i.service === args.service && i.id === args.id,
    );
    if (exists) {
      return {
        content: [{ type: "text" as const, text: `Invoice ${args.id} already in manifest, skipped.` }],
      };
    }

    manifest.invoices.push({
      service: args.service,
      id: args.id,
      date: args.date,
      amount: args.amount,
      filename: args.filename,
      downloadedAt: new Date().toISOString(),
      uploaded: args.uploaded ?? false,
    });

    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    return {
      content: [{ type: "text" as const, text: `Saved invoice ${args.id} to manifest.` }],
    };
  },
);
