# Logging Standard (Runtime Services)

This standard is mandatory for runtime services in `PRPilot`.

## Requirements

1. **Timestamp ownership**: Do not emit application-side timestamp fields; rely on Kubernetes/runtime log metadata.
2. **Output stream**: `stderr`.
3. **Log levels**: `DEBUG`, `INFO`, `WARN`, `ERROR`.
4. **Configurable level**: expose `LOG_LEVEL` env var.
5. **No `console.*`** in runtime source (`src/**/*.ts`).
6. **Debug diagnostics required** for core logic paths:
   - request handling
   - session management
   - command execution
   - auth/token refresh
   - git/PR workflow
7. **Correlation ID required** for request-scoped operations (for example `requestId`).

## Implementation Pattern

- Use a shared `logger` utility and avoid ad-hoc logging.
- Use contextual logging (`logger.withContext`) to inject correlation fields.
- Keep secrets out of log lines.

## Enforcement

Enforcement is implemented with:

- `npm run check:logging` (policy script).
- pre-commit hook (`.pre-commit-config.yaml`) that runs the check.

Run manually:

```bash
npm run check:logging
```
