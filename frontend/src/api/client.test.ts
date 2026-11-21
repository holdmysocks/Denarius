import { describe, expect, it, vi } from "vitest";
import { REFRESH_LOCK_NAME, shouldClearSessionAfterRefreshFailure, withCrossTabRefreshLock } from "./client";

describe("refresh failure session guard", () => {
  it("clears the session when the failed refresh still owns it", () => {
    expect(shouldClearSessionAfterRefreshFailure(3, 3)).toBe(true);
  });

  it("does not perform a second logout after the session was already cleared", () => {
    expect(shouldClearSessionAfterRefreshFailure(3, 4)).toBe(false);
  });
});

describe("cross-tab refresh lock", () => {
  it("runs the task directly when the Web Locks API is unavailable", async () => {
    const task = vi.fn(async () => "token");
    await expect(withCrossTabRefreshLock(task, null)).resolves.toBe("token");
    await expect(withCrossTabRefreshLock(task, {} as never)).resolves.toBe("token");
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("runs the task inside the named lock when available", async () => {
    let held = false;
    const names: string[] = [];
    const locks = {
      async request<T>(name: string, cb: () => Promise<T>): Promise<T> {
        names.push(name);
        held = true;
        try {
          return await cb();
        } finally {
          held = false;
        }
      },
    };
    const result = await withCrossTabRefreshLock(async () => (held ? "locked" : "unlocked"), locks);
    expect(result).toBe("locked");
    expect(names).toEqual([REFRESH_LOCK_NAME]);
  });

  it("serializes concurrent holders so the second sees the first's result", async () => {
    // Minimal in-memory lock manager: FIFO, one holder at a time.
    let tail: Promise<unknown> = Promise.resolve();
    const locks = {
      request<T>(_name: string, cb: () => Promise<T>): Promise<T> {
        const run = tail.then(cb);
        tail = run.catch(() => undefined);
        return run;
      },
    };
    let cookie = 1;
    const refresh = async () => {
      const sent = cookie;
      await new Promise((r) => setTimeout(r, 5));
      cookie = sent + 1; // the server rotates the single-use cookie
      return sent;
    };
    const [a, b] = await Promise.all([
      withCrossTabRefreshLock(refresh, locks),
      withCrossTabRefreshLock(refresh, locks),
    ]);
    expect([a, b]).toEqual([1, 2]);
  });
});
