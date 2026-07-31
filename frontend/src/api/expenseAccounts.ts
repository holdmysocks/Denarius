import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "./client";

export const expenseAccountsKeys = {
  all: ["expense-accounts"] as const,
  detail: (id: string) => ["expense-accounts", id] as const,
};

export interface ExpenseAccountOut {
  id: string;
  name: string;
  color: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ExpenseAccountCreate {
  name: string;
  color?: string;
  sort_order?: number;
}

export interface ExpenseAccountUpdate {
  name?: string;
  color?: string;
  sort_order?: number;
  is_active?: boolean;
}

export function useExpenseAccounts() {
  return useQuery<ExpenseAccountOut[]>({
    queryKey: expenseAccountsKeys.all,
    queryFn: async () => (await api.get<ExpenseAccountOut[]>("/expense-accounts")).data,
  });
}

export function useCreateExpenseAccount() {
  const qc = useQueryClient();
  return useMutation<ExpenseAccountOut, Error, ExpenseAccountCreate>({
    mutationFn: async (data) => (await api.post<ExpenseAccountOut>("/expense-accounts", data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseAccountsKeys.all }),
  });
}

export function useUpdateExpenseAccount(id: string) {
  const qc = useQueryClient();
  return useMutation<ExpenseAccountOut, Error, ExpenseAccountUpdate>({
    mutationFn: async (data) => (await api.put<ExpenseAccountOut>(`/expense-accounts/${id}`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: expenseAccountsKeys.all });
      qc.invalidateQueries({ queryKey: expenseAccountsKeys.detail(id) });
    },
  });
}

export function useDeleteExpenseAccount(id: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      await api.delete<void>(`/expense-accounts/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseAccountsKeys.all }),
  });
}
