import api, { refreshAccessToken } from "./client";
import { useAuthStore, type User } from "@/store/authStore";
import { detachPushOnSignOut, syncPushSubscription } from "@/lib/push";

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

// Set by an explicit sign-out. Until the next login, ProtectedRoute must not
// try to restore the session from the refresh cookie: the logout request may
// still be in flight, and a refresh that wins that race would mint a new
// session and sign the user straight back in.
let signedOutThisPageLoad = false;

export async function login(username: string, password: string): Promise<AuthTokens> {
  const response = await api.post<AuthTokens>("/auth/login", { username, password });
  signedOutThisPageLoad = false;
  // The backend also sets the HttpOnly refresh cookie on this response.
  useAuthStore.getState().setAccessToken(response.data.access_token);
  void hydrateAuthenticatedSession();
  return response.data;
}

export async function register(username: string, email: string, password: string): Promise<AuthTokens> {
  const response = await api.post<AuthTokens>("/auth/register", { username, email, password });
  signedOutThisPageLoad = false;
  // The backend also sets the HttpOnly refresh cookie on this response.
  useAuthStore.getState().setAccessToken(response.data.access_token);
  void hydrateAuthenticatedSession();
  return response.data;
}

export async function logout() {
  // Local logout is authoritative and must work offline. Clear credentials
  // first, then revoke the refresh cookie on the server as a best effort.
  signedOutThisPageLoad = true;
  detachPushOnSignOut(useAuthStore.getState().accessToken);
  useAuthStore.getState().logout();
  try {
    await api.post<void>("/auth/logout");
  } catch {
    // The app is logged out even if the server is unavailable. The refresh
    // token will also expire according to the backend policy.
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
  void syncPushSubscription();
}

let restorePromise: Promise<boolean> | null = null;

export function restoreSession(): Promise<boolean> {
  if (useAuthStore.getState().isAuthenticated) return Promise.resolve(true);
  if (signedOutThisPageLoad) return Promise.resolve(false);

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
