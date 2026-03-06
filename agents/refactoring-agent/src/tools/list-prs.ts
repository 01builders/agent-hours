import { Type } from "@sinclair/typebox";
import type { Octokit } from "@octokit/rest";
import type { AgentTool } from "@mariozechner/pi-agent-core";

export function makeListPrsTool(octokit: Octokit, owner: string, repo: string, since: string): AgentTool {
    return {
        name: "list_prs",
        label: "List PRs",
        description: `List pull requests for ${owner}/${repo} merged since ${since}. Returns an array of {number, title, body, merged_at, author, url}.`,
        parameters: Type.Object({}),
        execute: async (_toolCallId, _params, _signal) => {
            const { data } = await octokit.rest.pulls.list({
                owner,
                repo,
                state: "closed",
                sort: "updated",
                direction: "desc",
                per_page: 50,
            });

            const recent = data
                .filter((pr) => pr.merged_at && new Date(pr.merged_at) >= new Date(since))
                .map((pr) => ({
                    number: pr.number,
                    title: pr.title,
                    body: pr.body ?? "",
                    merged_at: pr.merged_at,
                    author: pr.user?.login ?? "unknown",
                    url: pr.html_url,
                }));

            const text =
                recent.length === 0
                    ? `No merged PRs found since ${since}.`
                    : JSON.stringify(recent, null, 2);

            return { content: [{ type: "text" as const, text }], details: recent };
        },
    };
}
