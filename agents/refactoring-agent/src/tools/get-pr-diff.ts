import { Type } from "@sinclair/typebox";
import type { Octokit } from "@octokit/rest";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const MAX_DIFF_CHARS = 60_000;

export function makeGetPrDiffTool(octokit: Octokit, owner: string, repo: string): AgentTool {
    return {
        name: "get_pr_diff",
        label: "Get PR diff",
        description: "Fetch the unified diff for a given pull request number.",
        parameters: Type.Object({
            pr_number: Type.Number({ description: "The pull request number to fetch the diff for." }),
        }),
        execute: async (_toolCallId, params) => {
            const response = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
                owner,
                repo,
                pull_number: (params as { pr_number: number }).pr_number,
                headers: { accept: "application/vnd.github.v3.diff" },
            });
            const diff = response.data as unknown as string;
            const capped =
                diff.length > MAX_DIFF_CHARS
                    ? diff.slice(0, MAX_DIFF_CHARS) + "\n...[diff truncated at 60k chars]"
                    : diff;
            return { content: [{ type: "text" as const, text: capped }], details: capped };
        },
    };
}
