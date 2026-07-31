import { describe, expect, it } from "vitest";
import { shouldClearSessionAfterRefreshFailure } from "./client";

describe("refresh failure session guard", () => {
  it("clears the session when the failed token still owns it", () => {
    expect(shouldClearSessionAfterRefreshFailure("token-a", "token-a")).toBe(true);
  });

  it("preserves a replacement session after a stale refresh fails", () => {
    expect(shouldClearSessionAfterRefreshFailure("token-a", "token-b")).toBe(false);
  });

  it("does not perform a second logout after the session is already cleared", () => {
    expect(shouldClearSessionAfterRefreshFailure("token-a", null)).toBe(false);
  });
});
