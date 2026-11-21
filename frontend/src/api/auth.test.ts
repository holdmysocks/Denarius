import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());
const refreshAccessToken = vi.hoisted(() => vi.fn());

vi.mock("./client", () => ({
  default: { post, get: vi.fn(), patch: vi.fn() },
  refreshAccessToken,
}));

import { login, logout, restoreSession } from "./auth";
import { useAuthStore } from "@/store/authStore";

describe("restoreSession after an explicit logout", () => {
  beforeEach(() => {
    post.mockReset();
    refreshAccessToken.mockReset();
    useAuthStore.getState().setAccessToken("access-token");
  });

  it("does not try to refresh, so a racing refresh cannot sign the user back in", async () => {
    post.mockResolvedValue({ data: undefined });

    await logout();
    const restored = await restoreSession();

    expect(restored).toBe(false);
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it("restores normally again once the user logs back in", async () => {
    post.mockResolvedValue({ data: undefined });
    await logout();

    post.mockResolvedValueOnce({ data: { access_token: "new", refresh_token: "", token_type: "bearer" } });
    await login("someone", "password");
    useAuthStore.getState().logout(); // e.g. the access token later expires

    refreshAccessToken.mockResolvedValue("refreshed");
    await restoreSession();
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });
});
