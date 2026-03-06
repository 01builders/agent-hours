import { Type } from "@sinclair/typebox";
import type { Octokit } from "@octokit/rest";
import type { AgentTool } from "@mariozechner/pi-agent-core";

/**
 * @param base  The base branch to PR into (e.g. "main"). Avoids an extra API call.
 */
export function makeCreateDraftPrTool(octokit: Octokit, owner: string, repo: string, base: string): AgentTool {
    return {
        name: "create_draft_pr",
        label: "Create draft PR",
        description:
            `Create a draft pull request against ${base} with refactoring suggestions. The head branch will be created from ${base} if it does not yet exist.`,
        parameters: Type.Object({
            title: Type.String({ description: "PR title." }),
            body: Type.String({ description: "PR body in Markdown — the full refactoring suggestions document." }),
            branch: Type.String({ description: "Head branch name for the PR (will be created from base if missing)." }),
        }),
        execute: async (_toolCallId, params) => {
            const { title, body, branch } = params as { title: string; body: string; branch: string };

            // Create head branch from base tip; 422 = already exists, anything else is a real error
            try {
                const { data: refData } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${base}` });
                await octokit.rest.git.createRef({
                    owner,
                    repo,
                    ref: `refs/heads/${branch}`,
                    sha: refData.object.sha,
                });
            } catch (err: unknown) {
                const status = (err as { status?: number }).status;
                if (status !== 422) throw err; // 422 = branch already exists — safe to continue
            }

            const { data } = await octokit.rest.pulls.create({
                owner,
                repo,
                title,
                body,
                head: branch,
                base,
                draft: true,
            });

            const text = `Draft PR #${String(data.number)} created: ${data.html_url}`;
            return {
                content: [{ type: "text" as const, text }],
                details: { url: data.html_url, number: data.number },
            };
        },
    };
}
