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
            const sinceDate = new Date(since);
            const recent: Array<{ number: number; title: string; body: string; merged_at: string | null; author: string; url: string }> = [];

            // Paginate and stop early once all results on a page are older than `since`
            for (let page = 1; ; page++) {
                const { data } = await octokit.rest.pulls.list({
                    owner,
                    repo,
                    state: "closed",
                    sort: "updated",
                    direction: "desc",
                    per_page: 100,
                    page,
                });

                if (data.length === 0) break;

                let allOlderThanSince = true;
                for (const pr of data) {
                    if (pr.merged_at && new Date(pr.merged_at) >= sinceDate) {
                        allOlderThanSince = false;
                        recent.push({
                            number: pr.number,
                            title: pr.title,
                            body: pr.body ?? "",
                            merged_at: pr.merged_at,
                            author: pr.user?.login ?? "unknown",
                            url: pr.html_url,
                        });
                    }
                }

                if (allOlderThanSince) break; // no need to paginate further
            }

            const text =
                recent.length === 0
                    ? `No merged PRs found since ${since}.`
                    : JSON.stringify(recent, null, 2);

            return { content: [{ type: "text" as const, text }], details: recent };
        },
    };
}
