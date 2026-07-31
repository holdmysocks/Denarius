import api, { refreshAccessToken } from "./client";
import { useAuthStore, type User } from "@/store/authStore";

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface UserPreferencesUpdate {
  theme_dark?: boolean;
  dashboard_hidden_accounts?: string[];
}

interface SystemTimezoneResponse {
  timezone: string | null;
}

export async function login(username: string, password: string): Promise<AuthTokens> {
  const response = await api.post<AuthTokens>("/auth/login", { username, password });
  const { access_token, refresh_token } = response.data;
  useAuthStore.getState().setTokens(access_token, refresh_token);
  void hydrateAuthenticatedSession();
  return response.data;
}

export async function register(username: string, email: string, password: string): Promise<AuthTokens> {
  const response = await api.post<AuthTokens>("/auth/register", { username, email, password });
  const { access_token, refresh_token } = response.data;
  useAuthStore.getState().setTokens(access_token, refresh_token);
  void hydrateAuthenticatedSession();
  return response.data;
}

export async function logout(refreshToken = useAuthStore.getState().refreshToken) {
  // Local logout is authoritative and must work offline. Capture the server
  // token first, then clear credentials before making a best-effort revoke.
  useAuthStore.getState().logout();
  if (!refreshToken) return;
  try {
    await api.post<void>("/auth/logout", { refresh_token: refreshToken });
  } catch {
    // The tab is logged out even if the server is unavailable. The token is
    // tab-scoped and will also expire according to the backend policy.
  }
}

export async function getMe(): Promise<User> {
  const response = await api.get<User>("/auth/me");
  useAuthStore.getState().setUser(response.data);
  return response.data;
}

export async function updatePreferences(
  userId: string,
  prefs: UserPreferencesUpdate,
): Promise<void> {
  await api.patch<void>(`/users/${userId}/preferences`, prefs);
}

export async function fetchSystemTimezone(): Promise<void> {
  const response = await api.get<SystemTimezoneResponse>("/system/timezone");
  const tz = response.data.timezone;
  if (tz) {
    const { useSettingsStore } = await import("@/store/settingsStore");
    useSettingsStore.getState().setTimezoneLocal(tz);
  }
}

async function hydrateAuthenticatedSession() {
  const results = await Promise.allSettled([getMe(), fetchSystemTimezone()]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("Post-login session hydration failed", result.reason);
    }
  }
}

let restorePromise: Promise<boolean> | null = null;

export function restoreSession(): Promise<boolean> {
  if (useAuthStore.getState().isAuthenticated) return Promise.resolve(true);
  if (!useAuthStore.getState().refreshToken) return Promise.resolve(false);

  if (!restorePromise) {
    restorePromise = (async () => {
      try {
        await refreshAccessToken();
        await hydrateAuthenticatedSession();
        return useAuthStore.getState().isAuthenticated;
      } catch {
        useAuthStore.getState().logout();
        return false;
      }
    })().finally(() => {
      restorePromise = null;
    });
  }
  return restorePromise;
}
