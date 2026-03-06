import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/utils/logger.js";

describe("logger format", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    logger.setLevel("INFO");
  });

  it("does not emit app-side time field", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    logger.setLevel("INFO");
    logger.info("hello world", { requestId: "abc" });

    const line = writeSpy.mock.calls.at(-1)?.[0];
    expect(typeof line).toBe("string");
    expect(line).toContain("level=INFO");
    expect(line).toContain('msg="hello world"');
    expect(line).toContain("requestId=abc");
    expect(line).not.toContain("time=");
  });
});
