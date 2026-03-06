import { Type } from "@sinclair/typebox";
import type { Octokit } from "@octokit/rest";
import type { AgentTool } from "@mariozechner/pi-agent-core";

export function makeCreateDraftPrTool(octokit: Octokit, owner: string, repo: string): AgentTool {
    return {
        name: "create_draft_pr",
        label: "Create draft PR",
        description:
            "Create a draft pull request with refactoring suggestions. The tool will create the head branch from the default branch if it does not yet exist.",
        parameters: Type.Object({
            title: Type.String({ description: "PR title." }),
            body: Type.String({ description: "PR body in Markdown — the full refactoring suggestions document." }),
            branch: Type.String({ description: "Head branch name for the PR (will be created if missing)." }),
        }),
        execute: async (_toolCallId, params, _signal) => {
            const { title, body, branch } = params as { title: string; body: string; branch: string };

            // Look up default branch
            const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
            const defaultBranch = repoData.default_branch;

            // Create the head branch from default branch tip (ignore 422 = already exists)
            try {
                const { data: refData } = await octokit.rest.git.getRef({
                    owner,
                    repo,
                    ref: `heads/${defaultBranch}`,
                });
                await octokit.rest.git.createRef({
                    owner,
                    repo,
                    ref: `refs/heads/${branch}`,
                    sha: refData.object.sha,
                });
            } catch {
                // branch already exists or network issue — proceed and let PR creation surface any real error
            }

            const { data } = await octokit.rest.pulls.create({
                owner,
                repo,
                title,
                body,
                head: branch,
                base: defaultBranch,
                draft: true,
            });

            const text = `Draft PR #${data.number} created: ${data.html_url}`;
            return {
                content: [{ type: "text" as const, text }],
                details: { url: data.html_url, number: data.number },
            };
        },
    };
}
