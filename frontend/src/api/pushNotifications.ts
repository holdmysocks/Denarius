import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "./client";

export interface PushPreferences {
  push_bills: boolean;
  push_budgets: boolean;
}

export interface PushSettingsOut extends PushPreferences {
  /** Devices signed in as this user that receive alerts. */
  device_count: number;
}

const key = ["notifications", "settings"] as const;

export function usePushSettings() {
  return useQuery<PushSettingsOut>({
    queryKey: key,
    queryFn: async () => (await api.get<PushSettingsOut>("/notifications/settings")).data,
  });
}

export function useUpdatePushSettings() {
  const qc = useQueryClient();
  return useMutation<PushSettingsOut, Error, PushPreferences>({
    mutationFn: async (prefs) => (await api.put<PushSettingsOut>("/notifications/settings", prefs)).data,
    onSuccess: (data) => qc.setQueryData(key, data),
  });
}

export function useSendTestPush() {
  return useMutation<{ delivered: number }, Error, void>({
    mutationFn: async () => (await api.post<{ delivered: number }>("/notifications/test")).data,
  });
}

export function useRefreshPushSettings() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: key });
}
