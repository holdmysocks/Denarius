import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { applyPreferencesToDOM, usePreferencesStore } from "./store/preferencesStore";
import { useAuthStore } from "./store/authStore";
import "./index.css";

try {
  applyPreferencesToDOM(usePreferencesStore.getState());
} catch (err) {
  console.error("Failed to apply preferences before mount:", err);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

// Drop every cached query when a session ends (explicit logout or an expired
// refresh), so the next person to sign in on this tab never sees the previous
// user's data, API keys or admin-only lists.
useAuthStore.subscribe((state, previous) => {
  if (previous.isAuthenticated && !state.isAuthenticated) {
    queryClient.clear();
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
