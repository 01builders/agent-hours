import { describe, expect, it } from "vitest";
import { isAuthorizedUser, verifyWebhookSecret } from "../../src/telegram/verify.js";

describe("verifyWebhookSecret", () => {
  it("returns true when secrets match", () => {
    expect(verifyWebhookSecret("abc", "abc")).toBe(true);
  });

  it("returns false when missing or mismatched", () => {
    expect(verifyWebhookSecret(undefined, "abc")).toBe(false);
    expect(verifyWebhookSecret("nope", "abc")).toBe(false);
  });
});

describe("isAuthorizedUser", () => {
  it("checks allowed user id", () => {
    expect(isAuthorizedUser(123, 123)).toBe(true);
    expect(isAuthorizedUser(999, 123)).toBe(false);
    expect(isAuthorizedUser(undefined, 123)).toBe(false);
  });
});
