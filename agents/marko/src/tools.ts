import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const OUTPUT_DIR = "output";

async function ensureOutputDir(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

const generateLogoParams = Type.Object({
  prompt: Type.String({
    description:
      "Detailed prompt for the logo. Include style, colors (hex values), mood, and any specific elements. Be very specific about the visual style.",
  }),
  filename: Type.String({
    description: 'Filename for the output image, e.g. "logo_minimal_v1.png"',
  }),
});

const saveBrandKitParams = Type.Object({
  content: Type.String({
    description: "The full brand kit document in markdown format.",
  }),
  filename: Type.String({
    description: 'Filename for the brand kit, e.g. "brand-kit.md"',
  }),
});

export const generateLogoTool: AgentTool<typeof generateLogoParams> = {
  name: "generate_logo",
  label: "Generate Logo",
  description:
    "Generate a logo image using Flux via Replicate. Use this after the user approves the color palette and brand direction. Generate multiple variations by calling this tool multiple times with different prompts.",
  parameters: generateLogoParams,
  execute: async (toolCallId, params, signal, onUpdate) => {
    const apiToken = process.env.REPLICATE_API_TOKEN;
    if (!apiToken) {
      throw new Error("REPLICATE_API_TOKEN environment variable is not set");
    }

    onUpdate?.({
      content: [{ type: "text", text: "Generating logo with Flux..." }],
      details: {},
    });

    // Create a prediction
    const response = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          prompt: params.prompt,
          aspect_ratio: "1:1",
          output_format: "png",
          num_outputs: 1,
        },
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Replicate API error (${response.status}): ${errorText}`);
    }

    let prediction = await response.json();

    // Poll for completion
    const pollStart = Date.now();
    const timeout = 120_000;

    while (prediction.status !== "succeeded" && prediction.status !== "failed") {
      if (Date.now() - pollStart > timeout) {
        throw new Error("Image generation timed out");
      }
      signal?.throwIfAborted();
      await new Promise((r) => setTimeout(r, 2000));

      onUpdate?.({
        content: [{ type: "text", text: `Status: ${prediction.status}...` }],
        details: {},
      });

      const pollResponse = await fetch(prediction.urls.get, {
        headers: { Authorization: `Bearer ${apiToken}` },
        signal,
      });
      prediction = await pollResponse.json();
    }

    if (prediction.status === "failed") {
      throw new Error(`Image generation failed: ${prediction.error}`);
    }

    const imageUrl = prediction.output?.[0];
    if (!imageUrl) {
      throw new Error("No image returned from Replicate");
    }

    // Download and save
    await ensureOutputDir();
    const imgResponse = await fetch(imageUrl, { signal });
    const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
    const filePath = join(OUTPUT_DIR, params.filename);
    await writeFile(filePath, imgBuffer);

    return {
      content: [
        {
          type: "text",
          text: `Logo saved to ${filePath}. Image URL: ${imageUrl}`,
        },
      ],
      details: { filePath, imageUrl },
    };
  },
};

export const saveBrandKitTool: AgentTool<typeof saveBrandKitParams> = {
  name: "save_brand_kit",
  label: "Save Brand Kit",
  description:
    "Save the final brand kit as a markdown file. Call this once the user has approved the color palette and brand guidelines.",
  parameters: saveBrandKitParams,
  execute: async (toolCallId, params, signal) => {
    await ensureOutputDir();
    const filePath = join(OUTPUT_DIR, params.filename);
    await writeFile(filePath, params.content, "utf-8");

    return {
      content: [{ type: "text", text: `Brand kit saved to ${filePath}` }],
      details: { filePath },
    };
  },
};
