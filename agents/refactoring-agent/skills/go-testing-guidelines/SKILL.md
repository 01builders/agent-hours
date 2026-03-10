---
name: go-testing-guidelines
description: Use this skill when writing tests for Go code to strictly follow the required table-driven test format and organization standards.
---

# Go Testing
Consistent, table-driven tests.

## Instructions
### Table Tests
- **Mandatory 2+ cases**.
- Maps; short keys.
- Compact closures (helpers).

```go
func TestSomething(t *testing.T) {
    specs := map[string]struct{ ... }{ ... }
    for name, spec := range specs {
        t.Run(name, func(t *testing.T) { /* ... */ })
    }
}
```

### Fuzz Testing
- Native `testing.F`.
- Seed `f.Add`.
- Focus stability/invariants.

### Coverage
- High coverage critical paths.
- Unit + Integration.
- Happy Path -> Edge Cases.

### Organization
- `_test.go` adjacent.
- Tests top. Helpers bottom.
- No section noise (`// --- TESTS ---`).
- `t.Logf` (NO `fmt.Printf`).
- `t.Helper()`.
- `testify` (`require`/`assert`).
- `require.Equal(t, ...)` (NO `require.New`).
- `t.Context()` (NO `Background`/`TODO`).
- `errors.Is`.
