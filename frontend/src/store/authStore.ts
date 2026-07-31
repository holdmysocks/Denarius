import { create } from "zustand";
import { usePreferencesStore } from "./preferencesStore";
import { useDashboardStore } from "./dashboardStore";

export interface User {
  id: string;
  username: string;
  email: string;
  role: "admin" | "member";
  is_active?: boolean;
  theme_dark?: boolean | null;
  dashboard_hidden_accounts?: string[] | null;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

function loadRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const sessionToken = window.sessionStorage.getItem("refresh_token");
    const legacyToken = window.localStorage.getItem("refresh_token");

    // One-time migration away from persistent storage. Session storage still
    // supports reloads, but closing the tab removes the long-lived credential.
    if (!sessionToken && legacyToken) {
      window.sessionStorage.setItem("refresh_token", legacyToken);
    }
    window.localStorage.removeItem("refresh_token");
    return sessionToken ?? legacyToken;
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
    return null;
  }
}

function persistRefreshToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) window.sessionStorage.setItem("refresh_token", token);
    else window.sessionStorage.removeItem("refresh_token");
    // Ensure an old build cannot have left a persistent copy behind.
    window.localStorage.removeItem("refresh_token");
  } catch {
    // The in-memory session remains usable even when storage is unavailable.
  }
}

function applyUserPreferences(user: User) {
  usePreferencesStore.getState().hydrateFromUser(user.theme_dark);
  if (user.dashboard_hidden_accounts != null) {
    useDashboardStore.getState().setHiddenAccounts(user.dashboard_hidden_accounts);
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: loadRefreshToken(),
  user: null,
  isAuthenticated: false,
  setTokens: (accessToken, refreshToken) => {
    persistRefreshToken(refreshToken);
    set({ accessToken, refreshToken, isAuthenticated: true });
  },
  setUser: (user) => {
    applyUserPreferences(user);
    set({ user });
  },
  logout: () => {
    persistRefreshToken(null);
    set({ accessToken: null, refreshToken: null, user: null, isAuthenticated: false });
  },
}));
