import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarClock, Pencil, Plus, TrendingUp, Wallet } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useDashboard } from "@/api/dashboard";
import { useAccountBalanceHistory, useAccounts } from "@/api/accounts";
import { useCategories } from "@/api/categories";
import {
  effectiveTransactionType,
  isPairedTransaction,
  isPairedTransfer,
  useCreateTransaction,
  useTransaction,
  useUpdateTransaction,
  type TransactionType,
  type TransactionUpdateInput,
} from "@/api/transactions";
import { useExpenseAccounts, type ExpenseAccountOut } from "@/api/expenseAccounts";
import { useDashboardStore } from "@/store/dashboardStore";
import { useSettingsStore } from "@/store/settingsStore";
import { formatCurrency, formatDate, formatMonth, todayString, cn } from "@/lib/utils";

const CHART_COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#84cc16",
];

const TIME_RANGES = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "12M", days: 365 },
  { label: "24M", days: 730 },
] as const;

function formatChartDate(dateStr: string, granularity: "daily" | "monthly"): string {
  if (granularity === "monthly") return formatMonth(dateStr);
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}


function AccountBalancesChart() {
  const [days, setDays] = useState(7);
  const { data, isLoading } = useAccountBalanceHistory(days);
  const hiddenAccountIds = useDashboardStore((s) => s.hiddenAccountIds);

  const granularity = data?.granularity ?? "monthly";
  const visibleAccounts = (data?.accounts ?? []).filter(
    (a) => !hiddenAccountIds.includes(a.id)
  );

  const chartData = (data?.dates ?? []).map((date, idx) => {
    const point: Record<string, string | number> = { date: formatChartDate(date, granularity) };
    for (const account of visibleAccounts) {
      point[account.name] = account.balances[idx];
    }
    return point;
  });

  const xInterval = Math.max(0, Math.floor(chartData.length / 6) - 1);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">Account Balances Over Time</CardTitle>
          <CardDescription className="text-xs">
            {visibleAccounts.length === 0
              ? "No accounts visible — update in Settings → Preferences"
              : `${visibleAccounts.length} account${visibleAccounts.length !== 1 ? "s" : ""}`}
          </CardDescription>
        </div>
        <div className="flex gap-1">
          {TIME_RANGES.map(({ label, days: d }) => (
            <Button
              key={label}
              variant={days === d ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setDays(d)}
            >
              {label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          </div>
        ) : visibleAccounts.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
            No accounts selected. Go to{" "}
            <Link to="/settings" className="ml-1 underline underline-offset-2">
              Settings → Preferences
            </Link>
            {" "}to choose which accounts to display.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval={xInterval}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) =>
                  new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "USD",
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(v)
                }
                width={64}
              />
              <Tooltip
                formatter={(value: number, name: string) => [formatCurrency(value), name]}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {visibleAccounts.map((account, i) => (
                <Line
                  key={account.id}
                  type="monotone"
                  dataKey={account.name}
                  stroke={account.color || CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

function SkeletonCard() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="h-4 w-24 bg-muted rounded animate-pulse" />
      </CardHeader>
      <CardContent>
        <div className="h-8 w-32 bg-muted rounded animate-pulse mb-2" />
        <div className="h-3 w-20 bg-muted rounded animate-pulse" />
      </CardContent>
    </Card>
  );
}

interface TxFormState {
  date: string;
  description: string;
  amount: string;
  type: TransactionType;
  account_id: string;
  transfer_account_id: string;
  expense_account_id: string;
  category_id: string;
  notes: string;
}

type EditTxFormState = TxFormState;

type TransactionMutationPayload = TransactionUpdateInput & {
  date: string;
  description: string;
};

function DashboardEditTxDialog({
  txId,
  accounts,
  expenseAccounts,
  categories,
  onClose,
}: {
  txId: string | null;
  accounts: { id: string; name: string }[];
  expenseAccounts: ExpenseAccountOut[];
  categories: { id: string; name: string; type: TransactionType }[];
  onClose: () => void;
}) {
  const { data: tx, isLoading } = useTransaction(txId);
  const updateTx = useUpdateTransaction(txId ?? "");
  const isPaired = tx ? isPairedTransaction(tx) : false;
  const isPairedTransferLeg = tx ? isPairedTransfer(tx) : false;
  const [form, setForm] = useState<EditTxFormState>({
    date: "",
    description: "",
    amount: "",
    type: "expense",
    account_id: "",
    transfer_account_id: "",
    expense_account_id: "",
    category_id: "none",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<TransactionMutationPayload | null>(null);

  useEffect(() => {
    if (tx) {
      const timeout = window.setTimeout(() => {
        setForm({
          date: tx.date,
          description: tx.description ?? "",
          amount: String(tx.amount),
          type: effectiveTransactionType(tx),
          account_id: tx.account_id,
          transfer_account_id: tx.transfer_account_id ?? "",
          expense_account_id: tx.expense_account_id ?? "",
          category_id: tx.category_id ?? "none",
          notes: tx.notes ?? "",
        });
      }, 0);
      return () => window.clearTimeout(timeout);
    }
  }, [tx]);

  function buildPayload(override?: TransactionMutationPayload["once_per_month_override"]): TransactionMutationPayload {
    if (isPaired) {
      return {
        date: form.date,
        description: form.description,
        notes: form.notes || null,
        ...(isPairedTransferLeg ? { amount: parseFloat(form.amount) } : {
          category_id: form.category_id !== "none" && form.category_id
            ? form.category_id
            : null,
          expense_account_id: form.expense_account_id || null,
        }),
        ...(override ? { once_per_month_override: override } : {}),
      };
    }
    return {
      date: form.date,
      description: form.description,
      amount: parseFloat(form.amount),
      type: form.type,
      account_id: form.account_id,
      notes: form.notes || null,
      category_id: form.category_id !== "none" && form.category_id ? form.category_id : null,
      transfer_account_id: form.type === "transfer" && form.transfer_account_id ? form.transfer_account_id : null,
      expense_account_id: (form.type === "expense" || form.type === "income") && form.expense_account_id ? form.expense_account_id : null,
      ...(override ? { once_per_month_override: override } : {}),
    };
  }

  async function submitPayload(payload: TransactionMutationPayload) {
    try {
      await updateTx.mutateAsync({ ...payload });
      setOverrideOpen(false);
      setPendingPayload(null);
      onClose();
    } catch (err: unknown) {
      const resp = (err as { response?: { status?: number; headers?: Record<string, string> } }).response;
      if (resp?.status === 409 && resp.headers?.["x-conflict"] === "once_per_month") {
        setPendingPayload(payload);
        setOverrideOpen(true);
      } else {
        setError("Failed to save changes. Please try again.");
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.description.trim()) { setError("Description is required."); return; }
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    if (!form.account_id) { setError("Asset account is required."); return; }
    if (form.type === "transfer" && !form.transfer_account_id) { setError("To account is required for transfers."); return; }
    if (form.type === "transfer" && form.transfer_account_id === form.account_id) { setError("From and To accounts must be different."); return; }
    await submitPayload(buildPayload());
  }

  return (
    <>
      <Dialog open={!!txId} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent onOpenAutoFocus={(e) => e.preventDefault()} className="max-w-[95vw] sm:max-w-md flex flex-col top-4 bottom-4 translate-y-0 sm:bottom-auto sm:top-[50svh] sm:-translate-y-1/2 sm:max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Edit Transaction</DialogTitle>
          </DialogHeader>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 rounded-full border-4 border-primary border-t-transparent animate-spin" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
              <div className="overflow-y-auto flex-1 min-h-0">
              <div className="space-y-4 py-2">
                {error && (
                  <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-3 py-2">
                    {error}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1 min-w-0">
                    <Label>Date</Label>
                    <Input
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm({ ...form, date: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1 min-w-0">
                    <Label>Type</Label>
                    <Select disabled={isPaired} value={form.type} onValueChange={(v) => setForm({
                      ...form,
                      type: v as TransactionType,
                      transfer_account_id: v !== "transfer" ? "" : form.transfer_account_id,
                      category_id: v === form.type ? form.category_id : "none",
                    })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="expense">Expense</SelectItem>
                        <SelectItem value="income">Income</SelectItem>
                        <SelectItem value="transfer">Transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Description</Label>
                  <Input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Amount ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={form.amount}
                      onChange={(e) => setForm({ ...form, amount: e.target.value })}
                      disabled={isPaired && !isPairedTransferLeg}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{form.type === "transfer" ? "From Asset Account" : "Asset Account"}</Label>
                    <SearchableSelect
                      disabled={isPaired}
                      value={form.account_id}
                      onValueChange={(v) => setForm({ ...form, account_id: v })}
                      options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                      placeholder="Select…"
                    />
                  </div>
                </div>
                {form.type === "transfer" && (
                  <div className="space-y-1">
                    <Label>To Asset Account</Label>
                    <SearchableSelect
                      disabled={isPairedTransferLeg}
                      value={form.transfer_account_id}
                      onValueChange={(v) => setForm({ ...form, transfer_account_id: v })}
                      options={accounts.filter((a) => a.id !== form.account_id).map((a) => ({ value: a.id, label: a.name }))}
                      placeholder="Select…"
                    />
                  </div>
                )}
                {(form.type === "expense" || form.type === "income") && (
                  <div className="space-y-1">
                    <Label>Expense Account</Label>
                    <SearchableSelect
                      value={form.expense_account_id || "none"}
                      onValueChange={(v) => setForm({ ...form, expense_account_id: v === "none" ? "" : v })}
                      options={[
                        { value: "none", label: "None" },
                        ...accounts.map((a) => ({ value: a.id, label: a.name, group: "Asset Accounts" })),
                        ...expenseAccounts.map((ea) => ({ value: ea.id, label: ea.name, group: "Expense Accounts" })),
                      ]}
                      placeholder="None"
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Category</Label>
                  <SearchableSelect
                    disabled={isPairedTransferLeg}
                    value={form.category_id}
                    onValueChange={(v) => setForm({ ...form, category_id: v })}
                    options={[
                      { value: "none", label: "Uncategorized" },
                      ...categories
                        .filter((c) => c.type === form.type)
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((c) => ({ value: c.id, label: c.name })),
                    ]}
                    placeholder="Uncategorized"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Notes</Label>
                  <Input
                    placeholder="Optional notes"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
              </div>
              </div>
              <DialogFooter className="pt-4">
                <DialogClose asChild>
                  <Button type="button" variant="outline">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={updateTx.isPending}>
                  {updateTx.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={overrideOpen} onOpenChange={(o) => { if (!o) { setOverrideOpen(false); setPendingPayload(null); } }}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Category already used this month</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This category is set to once per month but already has a transaction recorded. What type of payment is this?
          </p>
          <div className="flex flex-col gap-2 mt-2">
            <Button onClick={() => pendingPayload && submitPayload({ ...pendingPayload, once_per_month_override: "extra_payment" })} disabled={updateTx.isPending} variant="outline">
              Extra Payment
              <span className="ml-2 text-xs text-muted-foreground">— additional payment, bill stays the same</span>
            </Button>
            <Button onClick={() => pendingPayload && submitPayload({ ...pendingPayload, once_per_month_override: "next_month_payment" })} disabled={updateTx.isPending} variant="outline">
              Next Month Payment
              <span className="ml-2 text-xs text-muted-foreground">— paying ahead, advances bill cycle</span>
            </Button>
          </div>
          <DialogFooter className="mt-2">
            <DialogClose asChild>
              <Button variant="ghost" size="sm">Cancel</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const emptyTxForm = (tz: string): TxFormState => ({
  date: todayString(tz),
  description: "",
  amount: "",
  type: "expense",
  account_id: "",
  expense_account_id: "",
  transfer_account_id: "",
  category_id: "none",
  notes: "",
});

export default function DashboardPage() {
  const { data, isLoading, isError, error } = useDashboard();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const hiddenAccountIds = useDashboardStore((s) => s.hiddenAccountIds);
  const visibleAccounts = accounts.filter((a) => a.is_active && !hiddenAccountIds.includes(a.id));
  const { timezone } = useSettingsStore();

  const { data: expenseAccountsData } = useExpenseAccounts();
  const expenseAccounts = expenseAccountsData ?? [];

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<TxFormState>(() => emptyTxForm(useSettingsStore.getState().timezone));
  const [formError, setFormError] = useState<string | null>(null);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const createTx = useCreateTransaction();

  async function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.description.trim()) { setFormError("Description is required."); return; }
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) {
      setFormError("Amount must be greater than zero.");
      return;
    }
    if (!form.account_id) { setFormError("Account is required."); return; }
    if (form.type === "transfer" && !form.transfer_account_id) { setFormError("To account is required for transfers."); return; }
    if (form.type === "transfer" && form.transfer_account_id === form.account_id) { setFormError("From and To accounts must be different."); return; }
    try {
      await createTx.mutateAsync({
        date: form.date,
        description: form.description,
        amount: parseFloat(form.amount),
        type: form.type,
        account_id: form.account_id,
        notes: form.notes || null,
        category_id: form.category_id !== "none" && form.category_id ? form.category_id : null,
        transfer_account_id: form.type === "transfer" && form.transfer_account_id ? form.transfer_account_id : null,
        expense_account_id: (form.type === "expense" || form.type === "income") && form.expense_account_id ? form.expense_account_id : null,
      });
      setAddOpen(false);
      setForm(emptyTxForm(timezone));
    } catch {
      setFormError("Failed to add transaction. Please try again.");
    }
  }

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
        <div>
          <div className="h-7 w-36 bg-muted rounded animate-pulse mb-1" />
          <div className="h-4 w-56 bg-muted rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <Spinner />
      </div>
    );
  }

  if (isError || !data) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    return (
      <div className="p-3 sm:p-6">
        <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 text-sm">
          Failed to load dashboard: {errMsg}
        </div>
      </div>
    );
  }

  const dashboard = data;

  const nonBillSpending = dashboard.monthly_spending.non_bill_spending;
  const overBudget =
    nonBillSpending > dashboard.monthly_spending.budget_total &&
    dashboard.monthly_spending.budget_total > 0;
  const greenWidth =
    dashboard.monthly_spending.budget_total > 0
      ? overBudget
        ? (dashboard.monthly_spending.budget_total / nonBillSpending) * 100
        : (nonBillSpending / dashboard.monthly_spending.budget_total) * 100
      : 0;
  const redWidth = overBudget ? 100 - greenWidth : 0;

  const cashFlow = dashboard.monthly_spending.current_month_income - dashboard.monthly_spending.current_month;

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Your financial snapshot at a glance.</p>
        </div>
        <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) { setForm(emptyTxForm(timezone)); setFormError(null); } }}>
          <DialogTrigger asChild>
            <Button className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Transaction
            </Button>
          </DialogTrigger>
          <DialogContent onOpenAutoFocus={(e) => e.preventDefault()} className="max-w-[95vw] sm:max-w-md flex flex-col top-4 bottom-4 translate-y-0 sm:bottom-auto sm:top-[50svh] sm:-translate-y-1/2 sm:max-h-[85vh]">
            <DialogHeader>
              <DialogTitle>Add Transaction</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddSubmit} className="flex flex-col min-h-0 flex-1">
              <div className="overflow-y-auto flex-1 min-h-0">
              <div className="space-y-4 py-2">
                {formError && (
                  <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-3 py-2">
                    {formError}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1 min-w-0">
                    <Label>Date</Label>
                    <Input
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm({ ...form, date: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1 min-w-0">
                    <Label>Type</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({
                      ...form,
                      type: v as TransactionType,
                      transfer_account_id: v !== "transfer" ? "" : form.transfer_account_id,
                      category_id: v === form.type ? form.category_id : "none",
                    })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="expense">Expense</SelectItem>
                        <SelectItem value="income">Income</SelectItem>
                        <SelectItem value="transfer">Transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Description</Label>
                  <Input
                    placeholder="e.g. Grocery run"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Amount ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      value={form.amount}
                      onChange={(e) => setForm({ ...form, amount: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{form.type === "transfer" ? "From Account" : "Account"}</Label>
                    <SearchableSelect
                      value={form.account_id}
                      onValueChange={(v) => setForm({ ...form, account_id: v })}
                      options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                      placeholder="Select…"
                    />
                  </div>
                </div>
                {form.type === "transfer" && (
                  <div className="space-y-1">
                    <Label>To Account</Label>
                    <SearchableSelect
                      value={form.transfer_account_id}
                      onValueChange={(v) => setForm({ ...form, transfer_account_id: v })}
                      options={accounts.filter((a) => a.id !== form.account_id).map((a) => ({ value: a.id, label: a.name }))}
                      placeholder="Select…"
                    />
                  </div>
                )}
                {(form.type === "expense" || form.type === "income") && (
                  <div className="space-y-1">
                    <Label>Expense Account</Label>
                    <SearchableSelect
                      value={form.expense_account_id || "none"}
                      onValueChange={(v) => setForm({ ...form, expense_account_id: v === "none" ? "" : v })}
                      options={[
                        { value: "none", label: "None" },
                        ...accounts.map((a) => ({ value: a.id, label: a.name, group: "Asset Accounts" })),
                        ...expenseAccounts.map((ea) => ({ value: ea.id, label: ea.name, group: "Expense Accounts" })),
                      ]}
                      placeholder="None"
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Category</Label>
                  <SearchableSelect
                    value={form.category_id}
                    onValueChange={(v) => setForm({ ...form, category_id: v })}
                    options={[
                      { value: "none", label: "Uncategorized" },
                      ...categories
                        .filter((c) => c.type === form.type)
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((c) => ({ value: c.id, label: c.name })),
                    ]}
                    placeholder="Uncategorized"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Notes</Label>
                  <Input
                    placeholder="Optional notes"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
              </div>
              </div>
              <DialogFooter className="pt-4">
                <DialogClose asChild>
                  <Button type="button" variant="outline">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={createTx.isPending}>
                  {createTx.isPending ? "Saving…" : "Save Transaction"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Net Worth */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cash Flow</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className={cn(
                "text-2xl font-bold",
                cashFlow >= 0 ? "text-emerald-600" : "text-destructive"
              )}
            >
              {formatCurrency(cashFlow)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatCurrency(dashboard.monthly_spending.current_month_income)} income &minus;{" "}
              {formatCurrency(dashboard.monthly_spending.current_month)} expenses
            </p>
          </CardContent>
        </Card>

        {/* Monthly Spending */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Monthly Spending</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", overBudget ? "text-destructive" : "text-foreground")}>
              {formatCurrency(nonBillSpending)}
            </div>
            {dashboard.monthly_spending.budget_total > 0 ? (
              <>
                <p className="text-xs text-muted-foreground mt-1">
                  of {formatCurrency(dashboard.monthly_spending.budget_total)} budgeted
                </p>
                <div className="mt-2 h-1.5 w-full bg-muted rounded-full relative overflow-hidden">
                  <div
                    className="absolute top-0 left-0 h-full bg-emerald-500 transition-all"
                    style={{
                      width: `${greenWidth}%`,
                      borderRadius: overBudget ? '9999px 0 0 9999px' : '9999px',
                    }}
                  />
                  {overBudget && (
                    <div
                      className="absolute top-0 h-full bg-destructive transition-all"
                      style={{
                        left: `${greenWidth}%`,
                        width: `${redWidth}%`,
                        borderRadius: '0 9999px 9999px 0',
                      }}
                    />
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">No budget set for this month</p>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Bills */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-sm font-medium text-muted-foreground">Upcoming Bills</CardTitle>
              <p className="text-xs text-muted-foreground">Next 7 days</p>
            </div>
            <div className="flex items-center gap-2">
              {dashboard.upcoming_bills.length > 0 && (
                <Badge variant="secondary" className="text-xs">{dashboard.upcoming_bills.length}</Badge>
              )}
              <Link to="/recurring" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                View all
              </Link>
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {dashboard.upcoming_bills.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">No upcoming bills.</p>
            ) : (
              <div className="space-y-2">
                {dashboard.upcoming_bills.slice(0, 3).map((bill) => (
                  <div key={bill.id} className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate mr-2">{bill.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          bill.days_until_due < 0
                            ? "border-destructive text-destructive"
                            : bill.days_until_due <= 2
                            ? "border-orange-500 text-orange-500"
                            : "border-yellow-500 text-yellow-600"
                        )}
                      >
                        {bill.days_until_due < 0
                          ? `${Math.abs(bill.days_until_due)}d overdue`
                          : bill.days_until_due === 0
                          ? "Today"
                          : `${bill.days_until_due}d`}
                      </Badge>
                      <span className="text-sm font-semibold">{formatCurrency(bill.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Account Balances Chart */}
      <AccountBalancesChart />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Accounts & Balances */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base">Accounts</CardTitle>
              <CardDescription className="text-xs">Current balances</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/networth" className="flex items-center gap-1 text-xs">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {visibleAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No accounts selected.{" "}
                <Link to="/settings" className="underline underline-offset-2">
                  Settings → Preferences
                </Link>
              </p>
            ) : (
              <div className="space-y-3">
                {visibleAccounts.map((account) => {
                  const isAsset = ["checking", "savings", "investment", "property", "cash"].includes(account.type);
                  return (
                    <div key={String(account.id)} className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: account.color ?? "#6B7280" }}
                        />
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium truncate">{account.name}</span>
                          <span className="text-xs text-muted-foreground capitalize">
                            {account.type.replace("_", " ")}
                          </span>
                        </div>
                      </div>
                      <span
                        className={cn(
                          "text-sm font-semibold ml-4 shrink-0",
                          isAsset ? "text-emerald-600" : "text-destructive"
                        )}
                      >
                        {formatCurrency(Number(account.current_balance))}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Transactions */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base">Recent Transactions</CardTitle>
              <CardDescription className="text-xs">Last 10 transactions</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/transactions" className="flex items-center gap-1 text-xs">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {!dashboard.recent_transactions || dashboard.recent_transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No recent transactions found.</p>
            ) : (
              <div className="space-y-3">
                {dashboard.recent_transactions.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between group">
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium truncate">{tx.description}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(tx.date)}
                        {tx.category_name && ` · ${tx.category_name}`}
                        {tx.account_name && (
                          <>
                            {" · "}
                            <span style={{ color: tx.account_color ?? undefined }}>{tx.account_name}</span>
                          </>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 ml-4 shrink-0">
                      <span
                        className={cn(
                          "text-sm font-semibold",
                          tx.transfer_account_id ? "text-foreground" :
                          tx.type === "income" ? "text-emerald-600" : "text-destructive"
                        )}
                      >
                        {tx.transfer_account_id ? "" : tx.type === "income" ? "+" : "-"}
                        {formatCurrency(tx.amount)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => setEditingTxId(tx.id)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <DashboardEditTxDialog
        txId={editingTxId}
        accounts={accounts}
        expenseAccounts={expenseAccounts}
        categories={categories}
        onClose={() => setEditingTxId(null)}
      />
    </div>
  );
}
