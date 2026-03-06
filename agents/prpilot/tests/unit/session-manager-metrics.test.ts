import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderMetrics, resetMetricsRegistry } from "../../src/metrics/registry.js";
import { PiSessionManager } from "../../src/agent/session-manager.js";

describe("PiSessionManager metrics", () => {
  beforeEach(() => {
    resetMetricsRegistry();
  });

  it("records aborted session metric", async () => {
    const manager = new PiSessionManager({ sessionDir: "/tmp", isDev: true } as any);
    const abort = vi.fn().mockResolvedValue(undefined);

    (manager as any).sessions.set("42:ro:repo-one", {
      busy: false,
      session: { isStreaming: true, abort },
    });

    const result = await manager.abort(42);
    expect(result).toBe(true);

    const metrics = await renderMetrics();
    expect(metrics).toContain('pi_session_abort_total{result="aborted"} 1');
  });

  it("records no-active abort metric", async () => {
    const manager = new PiSessionManager({ sessionDir: "/tmp", isDev: true } as any);

    const result = await manager.abort(42);
    expect(result).toBe(false);

    const metrics = await renderMetrics();
    expect(metrics).toContain('pi_session_abort_total{result="no-active"} 1');
  });
});
