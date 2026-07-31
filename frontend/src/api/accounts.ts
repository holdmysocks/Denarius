import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "./client";
import type { MortgageCreateInput } from "./mortgage";

export type AccountType =
  | "checking"
  | "savings"
  | "credit_card"
  | "investment"
  | "mortgage"
  | "loan"
  | "property"
  | "cash"
  | "other";

export const accountsKeys = {
  all: ["accounts"] as const,
  detail: (id: string) => ["accounts", id] as const,
  transactions: (id: string) => ["accounts", id, "transactions"] as const,
};

export interface AccountOut {
  id: string;
  name: string;
  type: AccountType;
  institution?: string | null;
  account_number?: string | null;
  current_balance: number;
  initial_balance: number;
  credit_limit?: number | null;
  is_active: boolean;
  sort_order: number;
  notes?: string | null;
  color: string;
  linked_mortgage_id?: string | null;
}

export interface AccountCreateInput {
  name: string;
  type: AccountType;
  institution?: string | null;
  account_number?: string | null;
  current_balance?: number;
  credit_limit?: number | null;
  sort_order?: number;
  notes?: string | null;
  color?: string;
  linked_mortgage_id?: string | null;
}

export type AccountUpdateInput = Partial<AccountCreateInput> & { is_active?: boolean };

export interface NewLinkedMortgageInput {
  name: string;
  mortgage: MortgageCreateInput;
}

export interface AccountWithMortgageCreateInput {
  account: AccountCreateInput;
  mortgage?: MortgageCreateInput | null;
  new_linked_mortgage?: NewLinkedMortgageInput | null;
}

export interface AccountWithMortgageUpdateInput {
  account: AccountUpdateInput;
  mortgage?: MortgageCreateInput | null;
  new_linked_mortgage?: NewLinkedMortgageInput | null;
}

export function useAccounts() {
  return useQuery<AccountOut[]>({
    queryKey: accountsKeys.all,
    queryFn: () => api.get<AccountOut[]>("/accounts").then((r) => r.data),
  });
}

export function useAccount(id: string) {
  return useQuery<AccountOut>({
    queryKey: accountsKeys.detail(id),
    queryFn: () => api.get<AccountOut>(`/accounts/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation<AccountOut, Error, AccountCreateInput>({
    mutationFn: (data) => api.post<AccountOut>("/accounts", data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKeys.all }),
  });
}

export function useUpdateAccount(id: string) {
  const qc = useQueryClient();
  return useMutation<AccountOut, Error, AccountUpdateInput>({
    mutationFn: (data) => api.put<AccountOut>(`/accounts/${id}`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: accountsKeys.all });
      qc.invalidateQueries({ queryKey: accountsKeys.detail(id) });
    },
  });
}

export function useUpdateBalance(id: string) {
  const qc = useQueryClient();
  return useMutation<AccountOut, Error, number>({
    mutationFn: (balance) => api.put<AccountOut>(`/accounts/${id}/balance`, { balance }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: accountsKeys.all });
      qc.invalidateQueries({ queryKey: ["networth"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteAccount(id: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      await api.delete<void>(`/accounts/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKeys.all }),
  });
}

export interface AccountBalanceHistoryAccount {
  id: string;
  name: string;
  type: string;
  color?: string;
  balances: number[];
}

export interface AccountBalanceHistory {
  granularity: "daily" | "monthly";
  dates: string[];
  accounts: AccountBalanceHistoryAccount[];
}

export function useAccountBalanceHistory(days = 365) {
  return useQuery({
    queryKey: ["accounts", "balance-history", days],
    queryFn: (): Promise<AccountBalanceHistory> =>
      api.get<AccountBalanceHistory>(`/accounts/balance-history?days=${days}`).then((r) => r.data),
    staleTime: 60_000,
  });
}

export async function createAccountWithMortgage(
  data: AccountWithMortgageCreateInput,
): Promise<AccountOut> {
  return (await api.post<AccountOut>("/accounts/with-mortgage", data)).data;
}

export async function updateAccountWithMortgage(
  id: string,
  data: AccountWithMortgageUpdateInput,
): Promise<AccountOut> {
  return (await api.put<AccountOut>(`/accounts/${id}/with-mortgage`, data)).data;
}
