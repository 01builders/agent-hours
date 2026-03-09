import { describe, expect, test } from "vitest";
import { hashCommand, normalizeCommand, splitCommandSegments } from "../src/command-parser.js";

describe("command-parser", () => {
  test("splits command segments across control operators", () => {
    const segments = splitCommandSegments("docker compose ps && docker logs hyperlane-relayer --tail=10");
    expect(segments).toEqual(["docker compose ps", "docker logs hyperlane-relayer --tail=10"]);
  });

  test("does not split inside quoted strings", () => {
    const segments = splitCommandSegments("echo 'a && b' ; docker compose ps");
    expect(segments).toEqual(["echo 'a && b'", "docker compose ps"]);
  });

  test("normalization and hash are stable", () => {
    const a = hashCommand("docker    compose    ps");
    const b = hashCommand(normalizeCommand("docker compose ps"));
    expect(a).toBe(b);
  });
});
