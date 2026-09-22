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

let refreshPromise: Promise<string> | null = null;

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

const performRefresh = async (sessionVersion: number): Promise<string> => {
  // The refresh token travels in the HttpOnly cookie; the backend rotates it
  // and sets the replacement cookie on the response.
  const response = await axios.post<AuthTokens>("/api/v1/auth/refresh");
  const { access_token } = response.data;

  // A logout may have happened while this request was in flight. Never
  // resurrect that stale session.
  if (useAuthStore.getState().sessionVersion !== sessionVersion) {
    throw new Error("Authentication session changed during refresh");
  }
  useAuthStore.getState().setAccessToken(access_token);
  return access_token;
};

export function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    const promise = performRefresh(useAuthStore.getState().sessionVersion).finally(() => {
      if (refreshPromise === promise) refreshPromise = null;
    });
    refreshPromise = promise;
  }
  return refreshPromise;
}

export function shouldClearSessionAfterRefreshFailure(
  failedSessionVersion: number,
  currentSessionVersion: number,
): boolean {
  return currentSessionVersion === failedSessionVersion;
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

    const sessionVersion = useAuthStore.getState().sessionVersion;
    try {
      const accessToken = await refreshAccessToken();
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      if (
        shouldClearSessionAfterRefreshFailure(
          sessionVersion,
          useAuthStore.getState().sessionVersion,
        )
      ) {
        useAuthStore.getState().logout();
      }
      return Promise.reject(refreshError);
    }
  }
);

export default api;
