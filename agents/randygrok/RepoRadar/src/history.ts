import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const HISTORY_PATH = resolve(import.meta.dirname, "..", "history.json");
const MAX_DAYS = 14;

export interface ScanItem {
  repo: string;
  number: number;
  title: string;
  url: string;
}

export interface ScanFindings {
  prs_pending_review: ScanItem[];
  prs_awaiting_response: (ScanItem & { reviewers: string[]; unresolved_count: number })[];
  failing_checks: ScanItem[];
  stale_issues: (ScanItem & { days_inactive: number })[];
  open_prs_total: number;
  open_issues_total: number;
}

export interface ScanEntry {
  date: string;
  timestamp: string;
  findings: ScanFindings;
}

export type History = ScanEntry[];

export function loadHistory(): History {
  if (!existsSync(HISTORY_PATH)) return [];
  try {
    return JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
  } catch {
    return [];
  }
}

export function saveEntry(entry: ScanEntry): void {
  const history = loadHistory();

  // Replace if same date exists, otherwise append
  const idx = history.findIndex((e) => e.date === entry.date);
  if (idx >= 0) {
    history[idx] = entry;
  } else {
    history.push(entry);
  }

  // Keep only the last MAX_DAYS entries
  const trimmed = history
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_DAYS);

  writeFileSync(HISTORY_PATH, JSON.stringify(trimmed, null, 2) + "\n");
}

export function formatHistoryForPrompt(history: History): string {
  if (history.length === 0) return "No previous scans recorded.";

  return history
    .slice(-7)
    .map((entry) => {
      const f = entry.findings;
      const lines = [`### ${entry.date}`];

      if (f.prs_pending_review.length > 0) {
        lines.push(`- PRs pending your review: ${f.prs_pending_review.map((p) => `#${p.number} (${p.repo})`).join(", ")}`);
      }
      if (f.prs_awaiting_response.length > 0) {
        lines.push(`- Your PRs with unresolved comments: ${f.prs_awaiting_response.map((p) => `#${p.number} (${p.repo}, ${p.unresolved_count} threads, reviewers: ${p.reviewers.join("/")})`).join(", ")}`);
      }
      if (f.failing_checks.length > 0) {
        lines.push(`- Failing CI: ${f.failing_checks.map((p) => `#${p.number} (${p.repo})`).join(", ")}`);
      }
      if (f.stale_issues.length > 0) {
        lines.push(`- Stale issues: ${f.stale_issues.map((i) => `#${i.number} (${i.repo}, ${i.days_inactive}d)`).join(", ")}`);
      }
      lines.push(`- Totals: ${f.open_prs_total} open PRs, ${f.open_issues_total} open issues`);

      return lines.join("\n");
    })
    .join("\n\n");
}
