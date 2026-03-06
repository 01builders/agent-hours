import { z } from "zod";

export const ServiceConfigSchema = z.object({
  name: z.string(),
  billingUrl: z.string().url(),
  loginCheck: z.string(),
  hints: z.object({
    navigate: z.string(),
    extract: z.string(),
    download: z.string(),
  }),
});

export const ConfigSchema = z.object({
  downloadsDir: z.string(),
  chromeProfileDir: z.string(),
  driveFolderId: z.string().optional().default(""),
  services: z.record(z.string(), ServiceConfigSchema),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;

export const InvoiceSchema = z.object({
  id: z.string().describe("Invoice ID or number"),
  date: z.string().describe("Invoice date"),
  amount: z.string().describe("Invoice amount with currency"),
});

export type Invoice = z.infer<typeof InvoiceSchema>;

export const ManifestEntrySchema = z.object({
  service: z.string(),
  id: z.string(),
  date: z.string(),
  amount: z.string(),
  filename: z.string(),
  downloadedAt: z.string(),
  uploaded: z.boolean(),
});

export const ManifestSchema = z.object({
  invoices: z.array(ManifestEntrySchema),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export interface CLIOptions {
  fullSync: boolean;
  services: string[];
  upload: boolean;
  headless: boolean;
  dryRun: boolean;
  configPath: string;
  login: boolean;
}
