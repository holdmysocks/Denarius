import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "./client";
import type { CategoryOut } from "./categories";

type MoneyValue = number | string;

interface BudgetResponse {
  id: string;
  category_id: string;
  month: string;
  amount: MoneyValue;
  category: CategoryOut | null;
}

interface BudgetWithSpentResponse extends BudgetResponse {
  actual_spent: MoneyValue;
  remaining: MoneyValue;
  is_over_budget: boolean;
}

interface BudgetSummaryResponse {
  total_budgeted: MoneyValue;
  total_spent: MoneyValue;
  uncategorized_spent: MoneyValue;
  over_budget_categories: BudgetWithSpentResponse[];
}

interface MonthlyTargetResponse {
  month: string;
  amount: MoneyValue;
}

export interface BudgetOut extends Omit<BudgetResponse, "amount"> {
  amount: number;
}

export interface BudgetWithSpent extends Omit<BudgetWithSpentResponse, "amount" | "actual_spent" | "remaining"> {
  amount: number;
  actual_spent: number;
  remaining: number;
}

export interface BudgetSummary {
  total_budgeted: number;
  total_spent: number;
  uncategorized_spent: number;
  over_budget_categories: BudgetWithSpent[];
}

export interface BudgetCreate {
  category_id: string;
  month: string;
  amount: number;
}

export interface BudgetUpdate {
  amount: number;
}

export interface CopyMonthRequest {
  from_month: string;
  to_month: string;
  overwrite?: boolean;
}

export interface CopyMonthConflict {
  code: "destination_has_budgets";
  category_count: number;
  has_total: boolean;
  from_month: string;
  to_month: string;
}

export interface MonthlyTarget {
  month: string;
  amount: number;
}

export interface BudgetPreferences {
  keep_for_next_month: boolean;
}

function normalizeBudget(budget: BudgetResponse): BudgetOut {
  return { ...budget, amount: Number(budget.amount) };
}

function normalizeBudgetWithSpent(budget: BudgetWithSpentResponse): BudgetWithSpent {
  return {
    ...budget,
    amount: Number(budget.amount),
    actual_spent: Number(budget.actual_spent),
    remaining: Number(budget.remaining),
  };
}

export function useBudgets(month?: string) {
  return useQuery<BudgetWithSpent[]>({
    queryKey: ["budgets", month],
    queryFn: async () => {
      const { data } = await api.get<BudgetWithSpentResponse[]>("/budgets", {
        params: month ? { month } : {},
      });
      return data.map(normalizeBudgetWithSpent);
    },
  });
}

export function useBudgetSummary(month?: string) {
  return useQuery<BudgetSummary>({
    queryKey: ["budgets", "summary", month],
    queryFn: async () => {
      const { data } = await api.get<BudgetSummaryResponse>("/budgets/summary", {
        params: month ? { month } : {},
      });
      return {
        total_budgeted: Number(data.total_budgeted),
        total_spent: Number(data.total_spent),
        uncategorized_spent: Number(data.uncategorized_spent),
        over_budget_categories: data.over_budget_categories.map(normalizeBudgetWithSpent),
      };
    },
  });
}

export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation<BudgetOut, Error, BudgetCreate>({
    mutationFn: async (data) => normalizeBudget((await api.post<BudgetResponse>("/budgets", data)).data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateBudget(id: string) {
  const qc = useQueryClient();
  return useMutation<BudgetOut, Error, BudgetUpdate>({
    mutationFn: async (data) => normalizeBudget((await api.put<BudgetResponse>(`/budgets/${id}`, data)).data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await api.delete<void>(`/budgets/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useCopyMonth() {
  const qc = useQueryClient();
  return useMutation<BudgetOut[], Error, CopyMonthRequest>({
    mutationFn: async (data) => {
      const response = await api.post<BudgetResponse[]>("/budgets/copy-month", data);
      return response.data.map(normalizeBudget);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useMonthlyTarget(month?: string) {
  return useQuery<MonthlyTarget | null>({
    queryKey: ["budgets", "monthly-target", month],
    queryFn: async () => {
      try {
        const { data } = await api.get<MonthlyTargetResponse | null>("/budgets/monthly-target", {
          params: month ? { month } : {},
        });
        return data ? { ...data, amount: Number(data.amount) } : null;
      } catch {
        return null;
      }
    },
    enabled: !!month,
  });
}

export function useSetMonthlyTarget() {
  const qc = useQueryClient();
  return useMutation<MonthlyTarget, Error, { month: string; amount: number }>({
    mutationFn: async (data) => {
      const response = await api.put<MonthlyTargetResponse>("/budgets/monthly-target", data);
      return { ...response.data, amount: Number(response.data.amount) };
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["budgets", "monthly-target", variables.month] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteMonthlyTarget() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (month) => {
      await api.delete<void>("/budgets/monthly-target", { params: { month } });
    },
    onSuccess: (_data, month) => {
      qc.invalidateQueries({ queryKey: ["budgets", "monthly-target", month] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useBudgetPreferences() {
  return useQuery<BudgetPreferences>({
    queryKey: ["budgets", "preferences"],
    queryFn: async () => (await api.get<BudgetPreferences>("/budgets/preferences")).data,
  });
}

export function useSetBudgetPreferences() {
  const qc = useQueryClient();
  return useMutation<BudgetPreferences, Error, BudgetPreferences>({
    mutationFn: async (data) => (await api.put<BudgetPreferences>("/budgets/preferences", data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budgets", "preferences"] }),
  });
}
