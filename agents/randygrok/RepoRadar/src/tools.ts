import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { execSync } from "child_process";
import { saveEntry, type ScanFindings } from "./history.js";

function gh(args: string): string {
  try {
    return execSync(`gh ${args}`, {
      encoding: "utf-8",
      timeout: 30_000,
    }).trim();
  } catch (e: any) {
    throw new Error(`gh command failed: ${e.message}`);
  }
}

// --- List open PRs for a repo ---

const listOpenPrsParams = Type.Object({
  repo: Type.String({ description: "Repository in owner/repo format" }),
});

export const listOpenPrsTool: AgentTool<typeof listOpenPrsParams> = {
  name: "list_open_prs",
  label: "List Open PRs",
  description:
    "List all open pull requests for a repository. Returns PR number, title, author, creation date, and labels.",
  parameters: listOpenPrsParams,
  execute: async (toolCallId, params) => {
    const result = gh(
      `pr list --repo ${params.repo} --state open --json number,title,author,createdAt,labels,reviewRequests,isDraft,url --limit 100`
    );
    return {
      content: [{ type: "text", text: result || "No open PRs found." }],
      details: {},
    };
  },
};

// --- List PRs pending review by a specific user ---

const listPendingReviewsParams = Type.Object({
  repo: Type.String({ description: "Repository in owner/repo format" }),
  user: Type.String({ description: "GitHub username to check for pending reviews" }),
});

export const listPendingReviewsTool: AgentTool<typeof listPendingReviewsParams> = {
  name: "list_pending_reviews",
  label: "List Pending Reviews",
  description:
    "List open PRs where a specific user has been requested as a reviewer and hasn't reviewed yet.",
  parameters: listPendingReviewsParams,
  execute: async (toolCallId, params) => {
    const result = gh(
      `search prs --repo ${params.repo} --review-requested ${params.user} --state open --json number,title,author,createdAt,repository,url --limit 100`
    );
    return {
      content: [{ type: "text", text: result || "No pending reviews found." }],
      details: {},
    };
  },
};

// --- Get PR check status ---

const listPrChecksParams = Type.Object({
  repo: Type.String({ description: "Repository in owner/repo format" }),
  pr_number: Type.Number({ description: "Pull request number" }),
});

export const listPrChecksTool: AgentTool<typeof listPrChecksParams> = {
  name: "list_pr_checks",
  label: "List PR Checks",
  description:
    "Get the CI/CD check status for a specific pull request. Shows which checks passed, failed, or are pending.",
  parameters: listPrChecksParams,
  execute: async (toolCallId, params) => {
    const result = gh(
      `pr checks ${params.pr_number} --repo ${params.repo} --json name,state,description 2>&1 || true`
    );
    return {
      content: [{ type: "text", text: result || "No checks found." }],
      details: {},
    };
  },
};

// --- List open issues ---

const listOpenIssuesParams = Type.Object({
  repo: Type.String({ description: "Repository in owner/repo format" }),
});

export const listOpenIssuesTool: AgentTool<typeof listOpenIssuesParams> = {
  name: "list_open_issues",
  label: "List Open Issues",
  description:
    "List all open issues for a repository. Returns issue number, title, author, creation date, labels, assignees, and comment count.",
  parameters: listOpenIssuesParams,
  execute: async (toolCallId, params) => {
    const result = gh(
      `issue list --repo ${params.repo} --state open --json number,title,author,createdAt,labels,assignees,comments,url --limit 100`
    );
    return {
      content: [{ type: "text", text: result || "No open issues found." }],
      details: {},
    };
  },
};

// --- List stale issues (no activity in N days) ---

const listStaleIssuesParams = Type.Object({
  repo: Type.String({ description: "Repository in owner/repo format" }),
  days: Type.Number({ description: "Number of days without activity to consider stale" }),
});

export const listStaleIssuesTool: AgentTool<typeof listStaleIssuesParams> = {
  name: "list_stale_issues",
  label: "List Stale Issues",
  description:
    "List open issues that have had no activity (comments, updates) for a given number of days. Useful for finding forgotten or abandoned issues.",
  parameters: listStaleIssuesParams,
  execute: async (toolCallId, params) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - params.days);
    const dateStr = cutoff.toISOString().split("T")[0];

    const result = gh(
      `issue list --repo ${params.repo} --state open --json number,title,author,createdAt,updatedAt,labels,assignees,comments,url --limit 200`
    );

    if (!result) {
      return {
        content: [{ type: "text", text: "No open issues found." }],
        details: {},
      };
    }

    const issues = JSON.parse(result);
    const stale = issues.filter(
      (issue: any) => new Date(issue.updatedAt) < cutoff
    );

    return {
      content: [
        {
          type: "text",
          text: stale.length > 0
            ? JSON.stringify(stale, null, 2)
            : `No stale issues (older than ${params.days} days without activity).`,
        },
      ],
      details: {},
    };
  },
};

// --- List user's PRs with unresolved review comments ---

const listMyPrsAwaitingResponseParams = Type.Object({
  repo: Type.String({ description: "Repository in owner/repo format" }),
  user: Type.String({ description: "GitHub username (PR author)" }),
});

export const listMyPrsAwaitingResponseTool: AgentTool<typeof listMyPrsAwaitingResponseParams> = {
  name: "list_my_prs_awaiting_response",
  label: "List My PRs Awaiting Response",
  description:
    "List open PRs authored by the user that have unresolved review threads. These are PRs where a reviewer left comments that the user hasn't addressed yet. Shows who reviewed, how many unresolved threads, and the comment details.",
  parameters: listMyPrsAwaitingResponseParams,
  execute: async (toolCallId, params) => {
    const query = `
      query($searchQuery: String!) {
        search(query: $searchQuery, type: ISSUE, first: 50) {
          nodes {
            ... on PullRequest {
              number
              title
              url
              createdAt
              reviewThreads(first: 100) {
                nodes {
                  isResolved
                  comments(first: 5) {
                    nodes {
                      author { login }
                      body
                      createdAt
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const searchQuery = `repo:${params.repo} is:pr is:open author:${params.user}`;
    const result = gh(
      `api graphql -f query='${query.replace(/'/g, "\\'")}' -f searchQuery='${searchQuery}'`
    );

    if (!result) {
      return {
        content: [{ type: "text", text: "No open PRs found for this user." }],
        details: {},
      };
    }

    const data = JSON.parse(result);
    const prs = data.data.search.nodes;

    const prsWithUnresolved = prs
      .map((pr: any) => {
        const unresolvedThreads = (pr.reviewThreads?.nodes || []).filter(
          (t: any) => !t.isResolved
        );
        if (unresolvedThreads.length === 0) return null;

        const reviewers = new Set<string>();
        const comments = unresolvedThreads.map((t: any) => {
          const firstComment = t.comments.nodes[0];
          if (firstComment?.author?.login) reviewers.add(firstComment.author.login);
          return {
            reviewer: firstComment?.author?.login || "unknown",
            body: firstComment?.body || "",
            createdAt: firstComment?.createdAt || "",
          };
        });

        return {
          number: pr.number,
          title: pr.title,
          url: pr.url,
          createdAt: pr.createdAt,
          unresolvedCount: unresolvedThreads.length,
          reviewers: [...reviewers],
          comments,
        };
      })
      .filter(Boolean);

    if (prsWithUnresolved.length === 0) {
      return {
        content: [{ type: "text", text: "No PRs with unresolved review comments found." }],
        details: {},
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(prsWithUnresolved, null, 2) }],
      details: {},
    };
  },
};

// --- Save scan report to history ---

const scanItemSchema = Type.Object({
  repo: Type.String(),
  number: Type.Number(),
  title: Type.String(),
  url: Type.String(),
});

const saveScanReportParams = Type.Object({
  prs_pending_review: Type.Array(scanItemSchema, { description: "PRs pending the user's review" }),
  prs_awaiting_response: Type.Array(
    Type.Intersect([
      scanItemSchema,
      Type.Object({
        reviewers: Type.Array(Type.String()),
        unresolved_count: Type.Number(),
      }),
    ]),
    { description: "User's PRs with unresolved review comments" }
  ),
  failing_checks: Type.Array(scanItemSchema, { description: "PRs with failing CI checks" }),
  stale_issues: Type.Array(
    Type.Intersect([
      scanItemSchema,
      Type.Object({ days_inactive: Type.Number() }),
    ]),
    { description: "Issues with no recent activity" }
  ),
  open_prs_total: Type.Number({ description: "Total number of open PRs across all repos" }),
  open_issues_total: Type.Number({ description: "Total number of open issues across all repos" }),
});

export const saveScanReportTool: AgentTool<typeof saveScanReportParams> = {
  name: "save_scan_report",
  label: "Save Scan Report",
  description:
    "Save the current scan findings to history. Call this AFTER every scan so you can track progress over time. Include all findings from the current scan.",
  parameters: saveScanReportParams,
  execute: async (toolCallId, params) => {
    const now = new Date();
    const date = now.toISOString().split("T")[0];

    saveEntry({
      date,
      timestamp: now.toISOString(),
      findings: params as ScanFindings,
    });

    return {
      content: [{ type: "text", text: `Scan report saved for ${date}.` }],
      details: {},
    };
  },
};

// --- Get PR details ---

const getPrDetailsParams = Type.Object({
  repo: Type.String({ description: "Repository in owner/repo format" }),
  pr_number: Type.Number({ description: "Pull request number" }),
});

export const getPrDetailsTool: AgentTool<typeof getPrDetailsParams> = {
  name: "get_pr_details",
  label: "Get PR Details",
  description:
    "Get detailed information about a specific PR including description, files changed, review status, and comments.",
  parameters: getPrDetailsParams,
  execute: async (toolCallId, params) => {
    const result = gh(
      `pr view ${params.pr_number} --repo ${params.repo} --json number,title,body,author,createdAt,files,reviews,comments,state,mergeable,labels,reviewRequests,url`
    );
    return {
      content: [{ type: "text", text: result }],
      details: {},
    };
  },
};
