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
  user: User | null;
  isAuthenticated: boolean;
  // Incremented on every logout so in-flight refreshes can tell that the
  // session they started under no longer exists.
  sessionVersion: number;
  setAccessToken: (accessToken: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

// The refresh token lives in an HttpOnly cookie set by the backend, so it
// survives app restarts (including iOS home-screen apps) without ever being
// readable by page JavaScript. Remove copies left behind by older builds.
function clearLegacyRefreshToken() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem("refresh_token");
    window.localStorage.removeItem("refresh_token");
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
}

clearLegacyRefreshToken();

function applyUserPreferences(user: User) {
  usePreferencesStore.getState().hydrateFromUser(user.theme_dark);
  if (user.dashboard_hidden_accounts != null) {
    useDashboardStore.getState().setHiddenAccounts(user.dashboard_hidden_accounts);
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  isAuthenticated: false,
  sessionVersion: 0,
  setAccessToken: (accessToken) => {
    set({ accessToken, isAuthenticated: true });
  },
  setUser: (user) => {
    applyUserPreferences(user);
    set({ user });
  },
  logout: () => {
    set((state) => ({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      sessionVersion: state.sessionVersion + 1,
    }));
  },
}));
