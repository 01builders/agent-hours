---
name: review-pr
description: Review and address PR comments for the current branch's pull request. Use when the user wants to handle, triage, or fix PR review feedback. Fetches review comments, plans fixes, confirms with user, implements, and pushes.
---

# Review PR
Handle PR feedback.

## 1. Find PR
```bash
gh pr list --head $(git branch --show-current) --json number,title,url --jq '.[0]'
```
Stop if missing.

## 2. Fetch
```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments
gh api repos/{owner}/{repo}/pulls/{number}/reviews
```
Deduplicate bots. Group by issue.

## 3. Triage
1. **Read Code**. NO guessing.
2. **Check Resolved**.
3. **Classify**: Crit/High/Med/Low.
4. **Plan**: Describe fix.

Confirm with User:
| # | Issue | File:Line | Sev | Status | Fix |
|---|---|---|---|---|---|

## 4. Implement
- Fix.
- Verify (Build/Lint/Test).
- Commit. Do not Push.

## 5. Reply - print locally, do not push
- Addressed: Fix + SHA.
- False Pos: Explain why.

## Rules
- Read first.
- Scope only.
- Surface disagreements.
