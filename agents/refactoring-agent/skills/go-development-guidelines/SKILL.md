---
name: go-development-guidelines
description: Use this skill when writing or refactoring Go code to ensure adherence to project standards regarding code organization, error handling, concurrency, performance, and style.
---

# Go Development
Clean, efficient, idiomatic Go.

## Instructions
### Code Organization
- Standard Layout.
- Meaningful, single-responsibility packages.
- Interfaces near usage.

### CLI Apps
- `cobra` + `pflag`.
- `cmd/` directory.
- Verbose binary name (NO `server`).

### Error Handling
- Check errors.
- Short, descriptive messages.
- NO "failed"/"error" prefix.
- Log ONCE at boundary.
- `errors.Is`/`errors.As`.
- Wrap: `fmt.Errorf("do: %w", err)`.
- NO `panic`.

### Concurrency
- Judicious goroutines.
- Sync: Mutex/Channel.
- Context cancellation/timeouts.
- Watch race conditions.
- Be mindful of goroutine leaks.

### Performance
- Profile first. Benchmark.
- Watch allocations.

### Style
- `gofmt` / `goimports`.
- `golangci-lint`.
- Explicit > Implicit.
- Short functions.
- Comments: Why > What.
- CamelCase.
