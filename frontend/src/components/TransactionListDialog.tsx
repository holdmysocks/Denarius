import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "@/api/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { currentMonthParam, formatCurrency, formatDate, todayString } from "@/lib/utils";
import { useSettingsStore } from "@/store/settingsStore";

type TransactionListDialogFilter =
  | { kind: "account"; id: string }
  | { kind: "expense_account"; id: string }
  | { kind: "category"; id: string };

interface TransactionListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  filter: TransactionListDialogFilter;
}

interface Tx {
  id: string;
  date: string;
  description?: string | null;
  type: "income" | "expense" | "transfer";
  transfer_account_id?: string | null;
  amount: number | string;
  category?: { name: string } | null;
  expense_account_name?: string | null;
}

interface TransactionListResponse {
  items: Tx[];
  total: number;
  page: number;
  pages: number;
  limit: number;
}

const PARAM_KEY = {
  account: "account_id",
  expense_account: "expense_account_id",
  category: "category_id",
} as const;

export function TransactionListDialog({ open, onOpenChange, title, filter }: TransactionListDialogProps) {
  const { timezone } = useSettingsStore();
  const [startDate, setStartDate] = useState(() => currentMonthParam(timezone));
  const [endDate, setEndDate] = useState(() => todayString(timezone));

  useEffect(() => {
    if (open) {
      const timeout = window.setTimeout(() => {
        setStartDate(currentMonthParam(timezone));
        setEndDate(todayString(timezone));
      }, 0);
      return () => window.clearTimeout(timeout);
    }
  }, [open, timezone]);

  const params = {
    limit: 200,
    [PARAM_KEY[filter.kind]]: filter.id,
    ...(startDate ? { start_date: startDate } : {}),
    ...(endDate ? { end_date: endDate } : {}),
  };

  const { data, isLoading, isError } = useQuery<TransactionListResponse>({
    queryKey: ["transactions", "dialog", filter.kind, filter.id, startDate, endDate],
    queryFn: async () => (await api.get<TransactionListResponse>("/transactions", { params })).data,
    enabled: open,
  });

  const items = useMemo(() => data?.items ?? [], [data?.items]);

  const { income, expense, net } = useMemo(() => {
    const inc = items.filter((t) => t.type === "income" && !t.transfer_account_id).reduce((s, t) => s + Number(t.amount), 0);
    const exp = items.filter((t) => t.type === "expense" && !t.transfer_account_id).reduce((s, t) => s + Number(t.amount), 0);
    return { income: inc, expense: exp, net: inc - exp };
  }, [items]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{title} — Transactions</DialogTitle>
        </DialogHeader>

        {/* Date range bar */}
        <div className="flex items-center gap-4 px-6 pb-4 border-b">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">From</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-sm border border-input rounded-md px-2 py-1 bg-background"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">To</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="text-sm border border-input rounded-md px-2 py-1 bg-background"
            />
          </div>
        </div>

        {/* Scrollable transaction list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-7 w-7 rounded-full border-4 border-primary border-t-transparent animate-spin" />
            </div>
          ) : isError ? (
            <div className="text-center py-12 text-sm text-destructive">Failed to load transactions.</div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">No transactions found for this period.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-6 py-2 font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Description</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Category</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Type</th>
                  <th className="text-right px-6 py-2 font-medium text-muted-foreground">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((tx) => (
                  <tr key={tx.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-6 py-2.5 text-muted-foreground whitespace-nowrap">{formatDate(tx.date)}</td>
                    <td className="px-4 py-2.5 max-w-[200px]">
                      <div className="truncate">{tx.description ?? "—"}</div>
                      {tx.expense_account_name && (
                        <div className="text-xs text-muted-foreground truncate">{tx.expense_account_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{tx.category?.name ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={
                          tx.transfer_account_id
                            ? "text-muted-foreground text-xs font-medium"
                            : tx.type === "income"
                            ? "text-emerald-600 dark:text-emerald-400 text-xs font-medium"
                            : "text-destructive text-xs font-medium"
                        }
                      >
                        {tx.transfer_account_id ? "transfer" : tx.type}
                      </span>
                    </td>
                    <td
                      className={
                        "px-6 py-2.5 text-right font-semibold " +
                        (tx.transfer_account_id
                          ? "text-foreground"
                          : tx.type === "income"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive")
                      }
                    >
                      {tx.transfer_account_id ? "" : tx.type === "income" ? "+" : "-"}
                      {formatCurrency(Number(tx.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-t bg-muted/20">
          <span className="text-sm text-muted-foreground">{items.length} transaction{items.length !== 1 ? "s" : ""}</span>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-emerald-600 dark:text-emerald-400">
              Income: +{formatCurrency(income)}
            </span>
            <span className="text-destructive">
              Expenses: -{formatCurrency(expense)}
            </span>
            <span className={net >= 0 ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-destructive font-semibold"}>
              Net: {net >= 0 ? "+" : ""}{formatCurrency(net)}
            </span>
          </div>
          <DialogClose asChild>
            <Button variant="outline" size="sm">Close</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
