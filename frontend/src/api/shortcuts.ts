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

export type ShortcutKind = "expense" | "income";

/** Settings for one shortcut (Add Expense or Add Income). */
export interface ShortcutOptions {
  ask_description: boolean;
  ask_category: boolean;
  ask_account: boolean;
  default_account_id: string | null;
  default_category_id: string | null;
}

export interface ShortcutSettings {
  expense: ShortcutOptions;
  income: ShortcutOptions;
  auto_category: boolean;
  confirmation: ShortcutConfirmation;
}

export interface ShortcutSettingsOut extends ShortcutSettings {
  expense_shortcut_url: string | null;
  income_shortcut_url: string | null;
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

const updateSettingsMutationKey = ["shortcuts", "settings", "update"] as const;

function pickSettings(s: ShortcutSettings): ShortcutSettings {
  return { expense: s.expense, income: s.income, auto_category: s.auto_category, confirmation: s.confirmation };
}

/**
 * Saves shortcut settings optimistically. Callers pass an updater rather than
 * a full object: it is applied to the *latest* cached settings (including any
 * still-in-flight optimistic changes), so quick successive edits don't send a
 * stale copy that reverts the previous edit.
 */
export function useUpdateShortcutSettings() {
  const qc = useQueryClient();
  const mutation = useMutation<
    ShortcutSettingsOut,
    Error,
    ShortcutSettings,
    { previous: ShortcutSettingsOut | undefined }
  >({
    mutationKey: updateSettingsMutationKey,
    mutationFn: async (data) => (await api.put<ShortcutSettingsOut>("/shortcuts/settings", data)).data,
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: keys.settings });
      const previous = qc.getQueryData<ShortcutSettingsOut>(keys.settings);
      if (previous) qc.setQueryData<ShortcutSettingsOut>(keys.settings, { ...previous, ...next });
      return { previous };
    },
    onError: (_error, _next, context) => {
      // Only roll back when no newer save is in flight; otherwise that save's
      // optimistic value (which already includes ours) should stand.
      if (context?.previous && qc.isMutating({ mutationKey: updateSettingsMutationKey }) <= 1) {
        qc.setQueryData(keys.settings, context.previous);
      }
    },
    onSuccess: (data) => {
      // A newer save still in flight carries a fresher value; don't clobber it.
      if (qc.isMutating({ mutationKey: updateSettingsMutationKey }) <= 1) {
        qc.setQueryData(keys.settings, data);
      }
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey: updateSettingsMutationKey }) <= 1) {
        return qc.invalidateQueries({ queryKey: keys.settings });
      }
    },
  });

  function save(
    update: (current: ShortcutSettings) => ShortcutSettings,
    options?: Parameters<typeof mutation.mutate>[1],
  ) {
    const current = qc.getQueryData<ShortcutSettingsOut>(keys.settings);
    if (!current) return;
    mutation.mutate(pickSettings(update(pickSettings(current))), options);
  }

  return { ...mutation, save };
}

export function useSetShortcutLink() {
  const qc = useQueryClient();
  return useMutation<void, Error, { kind: ShortcutKind; shortcut_url: string | null }>({
    mutationFn: async (data) => {
      await api.put("/shortcuts/link", data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.settings }),
  });
}
