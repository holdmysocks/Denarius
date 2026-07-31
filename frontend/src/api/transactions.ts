import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "./client";
import type { CategoryOut } from "./categories";

export type TransactionType = "income" | "expense" | "transfer";
export type OncePerMonthOverride = "extra_payment" | "next_month_payment";

export interface TransactionOut {
  id: string;
  account_id: string;
  category_id: string | null;
  transfer_account_id: string | null;
  recurring_item_id: string | null;
  expense_account_id: string | null;
  paired_transaction_id: string | null;
  amount: number;
  type: TransactionType;
  description: string | null;
  notes: string | null;
  date: string;
  category: CategoryOut | null;
  recurring_item: { type: string } | null;
  account_name: string | null;
  account_color: string | null;
  expense_account_name: string | null;
  expense_account_color: string | null;
}

type TransactionIdentity = Pick<
  TransactionOut,
  "type" | "paired_transaction_id" | "transfer_account_id"
>;

export function isPairedTransaction(
  transaction: Pick<TransactionOut, "paired_transaction_id">,
): boolean {
  return Boolean(transaction.paired_transaction_id);
}

export function isPairedTransfer(transaction: TransactionIdentity): boolean {
  return isPairedTransaction(transaction) && Boolean(transaction.transfer_account_id);
}

export function effectiveTransactionType(transaction: TransactionIdentity): TransactionType {
  return isPairedTransfer(transaction) ? "transfer" : transaction.type;
}

export interface TransactionPagedResponse {
  items: TransactionOut[];
  total: number;
  page: number;
  pages: number;
  limit: number;
}

export interface TransactionQueryParams extends TransactionExportParams {
  page?: number;
  limit?: number;
}

export interface TransactionCreateInput {
  account_id: string;
  category_id?: string | null;
  transfer_account_id?: string | null;
  expense_account_id?: string | null;
  amount: number;
  type: TransactionType;
  description?: string | null;
  notes?: string | null;
  date: string;
  once_per_month_override?: OncePerMonthOverride;
}

export type TransactionUpdateInput = Partial<TransactionCreateInput>;

export interface TransactionExportParams {
  account_id?: string;
  category_id?: string;
  expense_account_id?: string;
  type?: string;
  search?: string;
  start_date?: string;
  end_date?: string;
}

export async function exportTransactionsCsv(params: TransactionExportParams): Promise<void> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }

  const response = await api.get<Blob>(`/transactions/export?${query.toString()}`, {
    responseType: "blob",
  });
  const disposition = response.headers["content-disposition"] ?? "";
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
  const filename = filenameMatch?.[1] ?? "transactions.csv";
  const url = URL.createObjectURL(response.data);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function useTransactions(params?: TransactionQueryParams) {
  return useQuery<TransactionPagedResponse>({
    queryKey: ["transactions", params],
    queryFn: () => api.get<TransactionPagedResponse>("/transactions", { params }).then((r) => r.data),
  });
}

export function useTransaction(id: string | null) {
  return useQuery<TransactionOut>({
    queryKey: ["transaction", id],
    queryFn: () => api.get<TransactionOut>(`/transactions/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation<TransactionOut, Error, TransactionCreateInput>({
    mutationFn: (data) => api.post<TransactionOut>("/transactions", data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["networth"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.refetchQueries({ queryKey: ["recurring"] });
    },
  });
}

export function useUpdateTransaction(id: string) {
  const qc = useQueryClient();
  return useMutation<TransactionOut, Error, TransactionUpdateInput>({
    mutationFn: (data) => api.put<TransactionOut>(`/transactions/${id}`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["networth"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.refetchQueries({ queryKey: ["recurring"] });
    },
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await api.delete<void>(`/transactions/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["networth"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.refetchQueries({ queryKey: ["recurring"] });
    },
  });
}

export function useBulkDeleteTransactions() {
  const qc = useQueryClient();
  return useMutation<void, Error, string[]>({
    mutationFn: async (ids) => {
      await api.post<void>("/transactions/bulk-delete", { ids });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["networth"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}
