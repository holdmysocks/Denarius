import { describe, expect, it } from "vitest";
import { shouldClearSessionAfterRefreshFailure } from "./client";

describe("refresh failure session guard", () => {
  it("clears the session when the failed refresh still owns it", () => {
    expect(shouldClearSessionAfterRefreshFailure(3, 3)).toBe(true);
  });

  it("does not perform a second logout after the session was already cleared", () => {
    expect(shouldClearSessionAfterRefreshFailure(3, 4)).toBe(false);
  });
});
