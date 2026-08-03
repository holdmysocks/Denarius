import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import api from "./client";

export type RecurringType = "subscription" | "bill" | "income";
export type RecurringFrequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "semiannually"
  | "annually";

export interface RecurringItemOut {
  id: string;
  name: string;
  account_id: string;
  category_id: string | null;
  amount: number;
  amount_min: number | null;
  amount_max: number | null;
  type: RecurringType;
  frequency: RecurringFrequency;
  day_of_month: number | null;
  next_due_date: string;
  auto_post: boolean;
  auto_match: boolean;
  keyword_match: string | null;
  is_active: boolean;
  notes: string | null;
  days_until_due: number;
  last_paid_date: string | null;
  last_paid_amount: number | null;
  last_paid_transaction_id: string | null;
  is_paid_current_period: boolean;
  expected_payments_this_month: number;
  paid_payments_this_month: number;
  expense_account_id: string | null;
}

export interface RecurringCreateInput {
  name: string;
  account_id: string;
  category_id?: string | null;
  amount: number;
  amount_min?: number | null;
  amount_max?: number | null;
  type: RecurringType;
  frequency: RecurringFrequency;
  day_of_month?: number | null;
  next_due_date: string;
  auto_post?: boolean;
  auto_match?: boolean;
  keyword_match?: string | null;
  notes?: string | null;
  expense_account_id?: string | null;
}

export type RecurringUpdateInput = Partial<RecurringCreateInput> & { is_active?: boolean };

export interface MarkPaidInput {
  id: string;
  date?: string;
  amount?: number;
  description?: string;
  account_id?: string;
  category_id?: string | null;
  source_account_id?: string;
}

export interface MarkPaidWithoutTransactionInput {
  id: string;
  date?: string;
  amount?: number;
}

// Immediately patch all type-filtered recurring caches with an updated item.
// Uses predicate matching to avoid relying on fuzzy key behaviour across TQ versions.
function patchRecurringItem(qc: QueryClient, updatedItem: RecurringItemOut) {
  qc.setQueriesData(
    {
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        query.queryKey[0] === "recurring" &&
        query.queryKey[1] !== "upcoming",
    },
    (old: unknown) => {
      if (!Array.isArray(old)) return old;
      return (old as RecurringItemOut[]).map((item) =>
        item.id === updatedItem.id ? updatedItem : item
      );
    }
  );
}

export function useRecurring(type?: RecurringType, isActive: boolean = true) {
  return useQuery<RecurringItemOut[]>({
    queryKey: ["recurring", type, isActive],
    queryFn: () =>
      api.get<RecurringItemOut[]>("/recurring", { params: { ...(type ? { type } : {}), is_active: isActive } }).then((r) => r.data),
  });
}

export function useUpcomingRecurring(days: number = 30) {
  return useQuery<RecurringItemOut[]>({
    queryKey: ["recurring", "upcoming", days],
    queryFn: () => api.get<RecurringItemOut[]>("/recurring/upcoming", { params: { days } }).then((r) => r.data),
  });
}

export function useCreateRecurring() {
  const qc = useQueryClient();
  return useMutation<RecurringItemOut, Error, RecurringCreateInput>({
    mutationFn: (data) => api.post<RecurringItemOut>("/recurring", data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
  });
}

export function useUpdateRecurring(id: string) {
  const qc = useQueryClient();
  return useMutation<RecurringItemOut, Error, RecurringUpdateInput>({
    mutationFn: (data) => api.put<RecurringItemOut>(`/recurring/${id}`, data).then((r) => r.data),
    onSuccess: async (updatedItem) => {
      patchRecurringItem(qc, updatedItem);
      await qc.refetchQueries({ queryKey: ["recurring"] });
    },
  });
}

export function useDeleteRecurring() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await api.delete<void>(`/recurring/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
  });
}

export function useMarkPaid() {
  const qc = useQueryClient();
  return useMutation<RecurringItemOut, Error, MarkPaidInput>({
    mutationFn: ({ id, ...data }) =>
      api.post<RecurringItemOut>(`/recurring/${id}/mark-paid`, data).then((r) => r.data),
    onSuccess: (updatedItem) => {
      patchRecurringItem(qc, updatedItem);
      qc.invalidateQueries({ queryKey: ["recurring"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["mortgage"] });
      qc.invalidateQueries({ queryKey: ["recurring", "summary"] });
    },
  });
}

export function useMarkPaidNoTransaction() {
  const qc = useQueryClient();
  return useMutation<RecurringItemOut, Error, MarkPaidWithoutTransactionInput>({
    mutationFn: ({ id, ...data }) =>
      api.post<RecurringItemOut>(`/recurring/${id}/mark-paid-no-transaction`, data).then((r) => r.data),
    onSuccess: (updatedItem) => {
      patchRecurringItem(qc, updatedItem);
      qc.invalidateQueries({ queryKey: ["recurring"] });
      qc.invalidateQueries({ queryKey: ["recurring", "summary"] });
    },
  });
}

export interface RecurringSummary {
  subscriptions_paid: number;
  subscriptions_count: number;
  subscriptions_expected: number;
  subscriptions_total: number;
  bills_paid: number;
  bills_count: number;
  bills_expected: number;
  bills_total: number;
  income_paid: number;
  income_count: number;
  income_expected: number;
  income_total: number;
}

export function useRecurringSummary() {
  return useQuery<RecurringSummary>({
    queryKey: ["recurring", "summary"],
    queryFn: () => api.get<RecurringSummary>("/recurring/summary").then((r) => r.data),
  });
}
