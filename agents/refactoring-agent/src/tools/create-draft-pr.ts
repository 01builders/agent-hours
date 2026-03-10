import { Type } from "@sinclair/typebox";
import type { Octokit } from "@octokit/rest";
import type { AgentTool } from "@mariozechner/pi-agent-core";

/**
 * @param base  The base branch to PR into (e.g. "main"). Avoids an extra API call.
 * @param forkOwner Optional fork repository owner to create the branch on
 * @param prOnFork Optional boolean to open the PR directly on the fork instead of the original repo
 */
export function makeCreateDraftPrTool(octokit: Octokit, owner: string, repo: string, base: string, forkOwner?: string, prOnFork?: boolean): AgentTool {
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
            const effectiveHeadOwner = forkOwner || owner;

            // Create head branch from base tip on the target (fork or main repo); 422 = already exists, anything else is a real error
            try {
                // Always get the base ref from the original repo
                const { data: refData } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${base}` });
                await octokit.rest.git.createRef({
                    owner: effectiveHeadOwner,
                    repo,
                    ref: `refs/heads/${branch}`,
                    sha: refData.object.sha,
                });
            } catch (err: unknown) {
                const status = (err as { status?: number }).status;
                if (status !== 422) throw err; // 422 = branch already exists — safe to continue
            }

            // NEW: Commit the suggestions to the branch so there is a diff for the PR
            try {
                // Check if file exists to get its SHA (in case of re-run on same branch)
                let fileSha: string | undefined;
                try {
                    const { data: fileData } = await octokit.rest.repos.getContent({
                        owner: effectiveHeadOwner,
                        repo,
                        path: "REFACTORING_SUGGESTIONS.md",
                        ref: branch,
                    });
                    if (!Array.isArray(fileData)) {
                        fileSha = fileData.sha;
                    }
                } catch {
                    // File doesn't exist yet, which is fine
                }

                await octokit.rest.repos.createOrUpdateFileContents({
                    owner: effectiveHeadOwner,
                    repo,
                    path: "REFACTORING_SUGGESTIONS.md",
                    message: "docs: Add refactoring suggestions",
                    content: Buffer.from(body).toString("base64"),
                    branch,
                    sha: fileSha,
                });
            } catch (err) {
                console.error("[refactoring-agent] Warning: could not commit suggestions file:", err);
                // Continue anyway, maybe there's already a diff from a previous manual commit
            }

            // Determine where the PR is being opened
            const targetOwner = (forkOwner && prOnFork) ? forkOwner : owner;
            
            // If opening on the original repo from a fork, we need a cross-repo specifier (forkOwner:branch).
            // If opening on the fork itself, or not using a fork, we just use the branch name.
            let prHead = branch;
            if (forkOwner && forkOwner !== owner && !prOnFork) {
                prHead = `${forkOwner}:${branch}`;
            }

            const { data } = await octokit.rest.pulls.create({
                owner: targetOwner,
                repo,
                title,
                body,
                head: prHead,
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
