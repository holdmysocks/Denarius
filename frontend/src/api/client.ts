import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "@/store/authStore";
import type { AuthTokens } from "./auth";

const api = axios.create({
  baseURL: "/api/v1",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    delete config.headers.Authorization;
  }
  return config;
});

interface RefreshAttempt {
  token: string;
  promise: Promise<string>;
}

let refreshAttempt: RefreshAttempt | null = null;

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

const performRefresh = async (refreshToken: string): Promise<string> => {
  const response = await axios.post<AuthTokens>("/api/v1/auth/refresh", {
    refresh_token: refreshToken,
  });
  const { access_token, refresh_token } = response.data;

  // A logout (or another explicit session replacement) may have happened
  // while this request was in flight. Never resurrect that stale session.
  if (useAuthStore.getState().refreshToken !== refreshToken) {
    throw new Error("Authentication session changed during refresh");
  }
  useAuthStore.getState().setTokens(access_token, refresh_token);
  return access_token;
};

export function refreshAccessToken(): Promise<string> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return Promise.reject(new Error("No refresh token available"));

  if (!refreshAttempt || refreshAttempt.token !== refreshToken) {
    const promise = performRefresh(refreshToken).finally(() => {
      if (refreshAttempt?.promise === promise) refreshAttempt = null;
    });
    refreshAttempt = { token: refreshToken, promise };
  }
  return refreshAttempt.promise;
}

export function shouldClearSessionAfterRefreshFailure(
  failedRefreshToken: string,
  currentRefreshToken: string | null,
): boolean {
  return currentRefreshToken === failedRefreshToken;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableRequestConfig | undefined;
    const requestPath = String(originalRequest?.url ?? "");
    const isAuthRequest = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"]
      .some((path) => requestPath.endsWith(path));
    if (!originalRequest || error.response?.status !== 401 || originalRequest._retry || isAuthRequest) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    const refreshToken = useAuthStore.getState().refreshToken;
    if (!refreshToken) {
      useAuthStore.getState().logout();
      return Promise.reject(error);
    }

    try {
      const accessToken = await refreshAccessToken();
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      if (
        shouldClearSessionAfterRefreshFailure(
          refreshToken,
          useAuthStore.getState().refreshToken,
        )
      ) {
        useAuthStore.getState().logout();
      }
      return Promise.reject(refreshError);
    }
  }
);

export default api;
