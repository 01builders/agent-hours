# Plan Template

Canonical output format for `ag plan`.

---

```markdown
# <Feature Name> Implementation Plan

**Goal:** <one sentence — what this builds and why>

**Architecture:** <2-4 sentences. Reference existing codebase packages/types.
Explain the key design decision and how it integrates with what exists.>

---

### Task 1: <short title>

**Files:**
- `exact/path/to/file.go` *(new)*
- `exact/path/to/existing.go` *(modify)*

**Description:** <paragraph explaining what to implement>

Include code snippets for new interfaces, structs, function signatures:

```go
type Backend interface {
    Name() string
    NewSession(ctx context.Context) (*Session, error)
    Send(ctx context.Context, sessionID string, items []string) error
    Stream(ctx context.Context, sessionID string, onEvent func(StreamEvent) error) error
    Cancel(ctx context.Context, sessionID string) error
}
```

Explain design rationale — why this shape, what existing code it replaces/wraps.

**Verification:** `go build ./internal/backend/...`

---

### Task 2: <short title>

**Depends On:** `task-1`

**Files:**
- `exact/path/to/provider.go` *(new)*

**Description:** Wrap existing calls into a struct implementing the interface.
Pure extraction — no logic changes.

```go
func init() { backend.Register(&Provider{}) }
```

**Verification:** `go build ./internal/backend/myprovider/...` succeeds;
`go test ./cmd/... -count=1` passes unchanged.

---

### Task N: Unit tests

**Depends On:** `task-1`, `task-2`

**Files:**
- `exact/path/to/backend_test.go` *(new)*

**Description:** Table-driven tests covering:
1. Register + Get round-trip for mock backend.
2. Get("unknown") returns ErrUnknownBackend sentinel.
3. MockBackend records calls for integration verification.

No real API/server needed — all tests use mocks.

**Verification:** `go test ./internal/backend/... -v -count=1`; `go vet ./...` clean.
```

## Field Reference

| Field | Required | Notes |
|-------|----------|-------|
| `# Title` | ✅ | Plan name |
| `**Goal:**` | ✅ | Single line |
| `**Architecture:**` | ✅ | 2-4 sentences, cite existing types |
| `### Task N: title` | ✅ | Sequential numbering |
| `**Files:**` + bullet list | ✅ | Backtick-wrapped paths with `*(new)*`/`*(modify)*` |
| `**Description:**` | ✅ | Include code snippets |
| `**Depends On:**` | Optional | Backtick-wrapped task IDs |
| `**Verification:**` | ✅ | Concrete commands |
| `**Model:**` | Optional | Override model for this task |
