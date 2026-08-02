import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "./client";

export type ForecastSource = "recurring" | "extra" | "budget";
export type ExtraExpenseFrequency = "monthly" | "yearly";

export interface ForecastLine {
  id: string;
  name: string;
  source: ForecastSource;
  frequency: string;
  amount: number;
  monthly_amount: number;
  yearly_amount: number;
  category_name: string | null;
  account_name: string | null;
}

export interface ForecastGroup {
  key: string;
  label: string;
  monthly_total: number;
  yearly_total: number;
  items: ForecastLine[];
}

export interface Forecast {
  as_of: string;
  income: ForecastGroup;
  expense_groups: ForecastGroup[];
  income_monthly: number;
  income_yearly: number;
  expenses_monthly: number;
  expenses_yearly: number;
  net_monthly: number;
  net_yearly: number;
  budgets_included: boolean;
  budget_month: string | null;
  budget_overlap_count: number;
}

export interface ExtraExpenseOut {
  id: string;
  name: string;
  amount: number;
  frequency: ExtraExpenseFrequency;
  notes: string | null;
  is_active: boolean;
}

export interface ExtraExpenseCreateInput {
  name: string;
  amount: number;
  frequency: ExtraExpenseFrequency;
  notes?: string | null;
}

export type ExtraExpenseUpdateInput = Partial<ExtraExpenseCreateInput> & { is_active?: boolean };

export function useForecast(includeBudgets: boolean = false) {
  return useQuery<Forecast>({
    queryKey: ["forecast", includeBudgets],
    queryFn: () =>
      api
        .get<Forecast>("/forecast", { params: { include_budgets: includeBudgets } })
        .then((r) => r.data),
  });
}

export function useExtraExpenses() {
  return useQuery<ExtraExpenseOut[]>({
    queryKey: ["extra-expenses"],
    queryFn: () => api.get<ExtraExpenseOut[]>("/forecast/extra-expenses").then((r) => r.data),
  });
}

function useExtraExpenseInvalidation() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["extra-expenses"] });
    qc.invalidateQueries({ queryKey: ["forecast"] });
  };
}

export function useCreateExtraExpense() {
  const invalidate = useExtraExpenseInvalidation();
  return useMutation<ExtraExpenseOut, Error, ExtraExpenseCreateInput>({
    mutationFn: (data) =>
      api.post<ExtraExpenseOut>("/forecast/extra-expenses", data).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateExtraExpense() {
  const invalidate = useExtraExpenseInvalidation();
  return useMutation<ExtraExpenseOut, Error, { id: string } & ExtraExpenseUpdateInput>({
    mutationFn: ({ id, ...data }) =>
      api.put<ExtraExpenseOut>(`/forecast/extra-expenses/${id}`, data).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteExtraExpense() {
  const invalidate = useExtraExpenseInvalidation();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await api.delete<void>(`/forecast/extra-expenses/${id}`);
    },
    onSuccess: invalidate,
  });
}
