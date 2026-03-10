---
name: plan-writer
description: Generate implementation plans for autonomous agent execution. Use when asked to create structured implementation plans for code changes.
---

# Plan Writer

Generate structured, executable implementation plans.

## Process

1. **Explore first** — Read source files. Understand existing abstractions, interfaces, registration patterns. Never plan blind.
2. **Identify seams** — Find packages, types, functions closest to needed changes. Note `init()`, blank imports, config keys.
3. **Write plan** — Follow template in `references/plan-template.md`. Include code snippets for all new types.
4. **Verify design** — Each task independently executable + verifiable. No task requires clarification.

## Quality Checklist

- [ ] Goal: single sentence
- [ ] Architecture: 2-4 sentences referencing existing codebase types
- [ ] 5-12 tasks, sequentially numbered
- [ ] Every task has: Files (with `*(new)*`/`*(modify)*`), Description (with code snippets), Verification (exact commands)
- [ ] Dependencies noted with `**Depends On:**`
- [ ] Interfaces model full lifecycle (session, streaming, cancel — not just request/response)
- [ ] Wiring shown (init, imports, config, CLI flags)
- [ ] Verification commands are concrete (`go build ./path/...`, `go test ./path/... -run TestX`)

## Anti-Patterns

- Generic "run tests" verification → use exact `go test` command with package path
- Table-only plans → NEVER use tables to list tasks. Each task MUST use the exact `### Task N: <title>` heading format.
- Missing file annotations → always mark `*(new)*` or `*(modify)*`
- Request/response-only interfaces → model full lifecycle
- No codebase references → Architecture must cite existing types/packages
- Monolithic tasks → split into interface → implementation → wiring → test

## References

- `references/plan-template.md` — canonical output format
