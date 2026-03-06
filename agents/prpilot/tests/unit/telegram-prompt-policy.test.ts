import { describe, expect, it } from "vitest";
import {
  buildTelegramAgentPrompt,
  TELEGRAM_REPOSITORY_SELF_SERVICE_RULES,
} from "../../src/agent/telegram-prompt-policy.js";

describe("telegram prompt policy", () => {
  it("builds chat prompts with shared self-service rules", () => {
    const prompt = buildTelegramAgentPrompt({
      repoName: "home-ops",
      agentsInstructions: "repo rules",
      taskLabel: "User message from Telegram:",
      task: "find 3 refactors",
      responseInstruction: "Respond for Telegram. Keep it concise and actionable.",
    });

    expect(prompt).toContain("Repository selected: home-ops");
    expect(prompt).toContain("Primary instructions for this repository (from AGENTS.md):");
    expect(prompt).toContain("repo rules");
    expect(prompt).toContain("User message from Telegram:");
    expect(prompt).toContain("find 3 refactors");
    for (const line of TELEGRAM_REPOSITORY_SELF_SERVICE_RULES) {
      expect(prompt).toContain(line);
    }
  });

  it("builds apply prompts with the same shared self-service rules", () => {
    const prompt = buildTelegramAgentPrompt({
      repoName: "home-ops",
      agentsInstructions: "repo rules",
      taskLabel: "Apply-mode task:",
      task: "apply changes",
      responseInstruction: "Execute the task directly in the repository and summarize results for Telegram.",
    });

    expect(prompt).toContain("Apply-mode task:");
    expect(prompt).toContain("apply changes");
    expect(prompt).toContain("Execute the task directly in the repository and summarize results for Telegram.");
    for (const line of TELEGRAM_REPOSITORY_SELF_SERVICE_RULES) {
      expect(prompt).toContain(line);
    }
  });
});
