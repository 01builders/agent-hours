import { tool } from "@anthropic-ai/claude-agent-sdk";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import type { Config } from "../types.js";

let stagehand: Stagehand | null = null;

export async function initBrowser(config: Config, headless: boolean): Promise<Stagehand> {
  if (stagehand) return stagehand;

  stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    model: "anthropic/claude-sonnet-4-5",
    localBrowserLaunchOptions: {
      headless,
      userDataDir: config.chromeProfileDir,
      preserveUserDataDir: true,
      acceptDownloads: true,
      downloadsPath: config.downloadsDir,
      args: ["--disable-blink-features=AutomationControlled"],
    },
  });

  await stagehand.init();
  return stagehand;
}

export async function closeBrowser(): Promise<void> {
  if (stagehand) {
    await stagehand.close();
    stagehand = null;
  }
}

export function getStagehand(): Stagehand {
  if (!stagehand) throw new Error("Browser not initialized. Call initBrowser() first.");
  return stagehand;
}

export const checkLogin = tool(
  "check_login",
  "Check if the user is logged in to a service by navigating to its billing URL and looking for login indicators",
  {
    service: z.string().describe("Service key"),
    billingUrl: z.string().describe("Billing page URL"),
    loginCheck: z.string().describe("Text that indicates a login form is present"),
  },
  async (args) => {
    const sh = getStagehand();
    const page = sh.context.pages()[0];
    await page.goto(args.billingUrl, { waitUntil: "networkidle", timeoutMs: 30000 });

    const result = await sh.extract(
      `Is there a login or sign-in form visible? Look for text like "${args.loginCheck}". Return whether the user appears to be logged in or needs to log in.`,
      z.object({
        loggedIn: z.boolean().describe("true if the user is logged in and can see billing content"),
        message: z.string().describe("Brief description of what is visible on the page"),
      }),
    );

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

export const browseBilling = tool(
  "browse_billing",
  "Navigate to the invoices/billing history section of a service",
  {
    service: z.string().describe("Service key"),
    billingUrl: z.string().describe("Billing page URL"),
    navigateHint: z.string().describe("Natural language instruction for navigating to invoices"),
  },
  async (args) => {
    const sh = getStagehand();
    const page = sh.context.pages()[0];

    const currentUrl = page.url();
    if (!currentUrl.includes(new URL(args.billingUrl).hostname)) {
      await page.goto(args.billingUrl, { waitUntil: "networkidle", timeoutMs: 30000 });
    }

    const actResult = await sh.act(args.navigateHint);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: actResult.success,
          currentUrl: page.url(),
          message: actResult.message,
        }, null, 2),
      }],
    };
  },
);

export const listInvoices = tool(
  "list_invoices",
  "Extract the list of invoices visible on the current billing page",
  {
    service: z.string().describe("Service key"),
    extractHint: z.string().describe("Natural language instruction for extracting invoice data"),
  },
  async (args) => {
    const sh = getStagehand();

    const invoices = await sh.extract(
      args.extractHint,
      z.array(z.object({
        id: z.string().describe("Invoice ID, number, or unique identifier"),
        date: z.string().describe("Invoice date"),
        amount: z.string().describe("Invoice amount with currency symbol"),
      })),
    );

    return {
      content: [{ type: "text" as const, text: JSON.stringify({ invoices }, null, 2) }],
    };
  },
);
