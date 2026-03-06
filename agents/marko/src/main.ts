import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { createInterface } from "readline";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { SYSTEM_PROMPT } from "./prompt.js";
import { generateLogoTool, saveBrandKitTool } from "./tools.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function loadImageAsBase64(
  filePath: string
): Promise<{ type: "image"; data: string; mimeType: string }> {
  const absPath = resolve(filePath);
  const buffer = await readFile(absPath);
  const ext = filePath.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
  };
  const mimeType = mimeMap[ext ?? ""] ?? "image/png";
  return {
    type: "image",
    data: buffer.toString("base64"),
    mimeType,
  };
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("Error: OPENROUTER_API_KEY environment variable is not set");
    process.exit(1);
  }
  if (!process.env.REPLICATE_API_TOKEN) {
    console.error("Error: REPLICATE_API_TOKEN environment variable is not set");
    process.exit(1);
  }

  const model = getModel("openrouter", "anthropic/claude-sonnet-4.6");

  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      tools: [generateLogoTool, saveBrandKitTool],
    },
  });

  agent.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
    if (event.type === "tool_execution_start") {
      console.log(`\n[Using tool: ${event.toolName}]`);
    }
    if (event.type === "tool_execution_end") {
      console.log(`[Tool complete: ${event.toolCallId}]`);
    }
  });

  console.log("BrandForge - Brand Kit Generator");
  console.log("================================");
  console.log(
    "Describe your brand concept. You can also provide image paths for inspiration."
  );
  console.log('Type "quit" to exit.\n');

  while (true) {
    const input = await ask("\nYou: ");
    if (input.trim().toLowerCase() === "quit") break;
    if (!input.trim()) continue;

    // Check for image paths in the input
    const imagePathRegex = /\[image:\s*(.+?)\]/g;
    const images: { type: "image"; data: string; mimeType: string }[] = [];
    let textContent = input;

    let match;
    while ((match = imagePathRegex.exec(input)) !== null) {
      try {
        const img = await loadImageAsBase64(match[1].trim());
        images.push(img);
        textContent = textContent.replace(match[0], "").trim();
      } catch (err) {
        console.error(`Warning: Could not load image "${match[1]}": ${err}`);
      }
    }

    console.log("\nBrandForge: ");

    if (images.length > 0) {
      await agent.prompt(textContent || "Here are my inspiration images.", images);
    } else {
      await agent.prompt(input);
    }

    console.log("");
  }

  rl.close();
  console.log("\nGoodbye!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
