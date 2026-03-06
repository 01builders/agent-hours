import { describe, expect, it } from "vitest";
import { redactField, redactText } from "../../src/utils/redact.js";

describe("redactText", () => {
  it("redacts common secret formats", () => {
    const input = 'TOKEN=abc123 Bearer mytoken {"token":"abc"} 123456:ABCDEFGHIJKLMNOPQRSTUV';
    const output = redactText(input);

    expect(output).toContain("TOKEN=***REDACTED***");
    expect(output).toContain("Bearer ***REDACTED***");
    expect(output).toContain('"token":"***REDACTED***"');
    expect(output).not.toContain("abc123");
  });
});

describe("redactField", () => {
  it("redacts sensitive keys", () => {
    expect(redactField("apiToken", "secret")).toBe("***REDACTED***");
  });

  it("passes non-sensitive keys through text redaction", () => {
    expect(redactField("note", "hello")).toBe("hello");
  });
});
