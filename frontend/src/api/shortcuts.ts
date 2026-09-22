import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "./client";

export interface ApiKeyOut {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiKeyCreated extends ApiKeyOut {
  key: string;
}

export type ShortcutConfirmation = "notify" | "speak" | "none";

export interface ShortcutSettings {
  ask_description: boolean;
  ask_type: boolean;
  ask_category: boolean;
  ask_account: boolean;
  default_type: "expense" | "income";
  default_account_id: string | null;
  default_category_id: string | null;
  auto_category: boolean;
  confirmation: ShortcutConfirmation;
}

export interface ShortcutSettingsOut extends ShortcutSettings {
  shortcut_url: string | null;
}

const keys = {
  apiKeys: ["shortcuts", "keys"] as const,
  settings: ["shortcuts", "settings"] as const,
};

export function useApiKeys() {
  return useQuery<ApiKeyOut[]>({
    queryKey: keys.apiKeys,
    queryFn: async () => (await api.get<ApiKeyOut[]>("/shortcuts/keys")).data,
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation<ApiKeyCreated, Error, string>({
    mutationFn: async (name) => (await api.post<ApiKeyCreated>("/shortcuts/keys", { name })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.apiKeys }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await api.delete<void>(`/shortcuts/keys/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.apiKeys }),
  });
}

export function useShortcutSettings() {
  return useQuery<ShortcutSettingsOut>({
    queryKey: keys.settings,
    queryFn: async () => (await api.get<ShortcutSettingsOut>("/shortcuts/settings")).data,
  });
}

export function useUpdateShortcutSettings() {
  const qc = useQueryClient();
  return useMutation<ShortcutSettingsOut, Error, ShortcutSettings>({
    mutationFn: async (data) => (await api.put<ShortcutSettingsOut>("/shortcuts/settings", data)).data,
    onSuccess: (data) => qc.setQueryData(keys.settings, data),
  });
}

export function useSetShortcutLink() {
  const qc = useQueryClient();
  return useMutation<{ shortcut_url: string | null }, Error, string | null>({
    mutationFn: async (shortcut_url) =>
      (await api.put<{ shortcut_url: string | null }>("/shortcuts/link", { shortcut_url })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.settings }),
  });
}
