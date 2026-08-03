import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Pencil, Trash2, CheckCircle, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  useRecurring,
  useRecurringSummary,
  useCreateRecurring,
  useUpdateRecurring,
  useDeleteRecurring,
  useMarkPaid,
  useMarkPaidNoTransaction,
  type RecurringCreateInput,
  type RecurringFrequency,
  type RecurringItemOut,
  type RecurringType,
} from "@/api/recurring";
import { useAccounts, type AccountOut } from "@/api/accounts";
import { useCategories, type CategoryOut } from "@/api/categories";
import { useExpenseAccounts } from "@/api/expenseAccounts";
import { formatCurrency, formatDate, todayString, cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settingsStore";

const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannually: "Semi-annually",
  annually: "Annually",
};

interface RecurringFormState {
  name: string;
  amount: string;
  amount_min: string;
  amount_max: string;
  is_variable: boolean;
  type: RecurringType;
  frequency: RecurringFrequency;
  start_date: string;
  account_id: string;
  category_id: string;
  notes: string;
  auto_match: boolean;
  keyword_match: string;
  expense_account_id: string;
}

const emptyForm = (tz: string): RecurringFormState => ({
  name: "",
  amount: "",
  amount_min: "",
  amount_max: "",
  is_variable: false,
  type: "bill",
  frequency: "monthly",
  start_date: todayString(tz),
  account_id: "none",
  category_id: "none",
  notes: "",
  auto_match: false,
  keyword_match: "",
  expense_account_id: "none",
});

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

const PAYABLE_ACCOUNT_TYPES = ["checking", "savings", "cash", "credit_card", "other"];

const SUMMARY_LABELS: Record<string, string> = {
  bill: "Bills",
  subscription: "Subscriptions",
  income: "Income",
};

function RecurringSummaryCard({ type }: { type: "subscription" | "bill" | "income" }) {
  const { data: summary } = useRecurringSummary();

  if (!summary) return null;

  const prefix = type === "subscription" ? "subscriptions" : type === "bill" ? "bills" : "income";
  const paidAmount = summary[`${prefix}_paid` as keyof typeof summary] as number;
  const paidCount = summary[`${prefix}_count` as keyof typeof summary] as number;
  const totalAmount = summary[`${prefix}_expected` as keyof typeof summary] as number;
  const totalOccurrences = summary[`${prefix}_total` as keyof typeof summary] as number;

  const paidPct = totalAmount > 0 ? Math.min(100, (paidAmount / totalAmount) * 100) : 0;
  const allPaid = totalAmount > 0 && paidPct >= 100;

  if (totalAmount === 0) return null;

  const actionLabel = type === "income" ? "received" : "paid";

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {SUMMARY_LABELS[type]}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-bold", allPaid ? "text-emerald-500" : "text-foreground")}>
          {formatCurrency(paidAmount)}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {paidCount} of {totalOccurrences} {actionLabel} · {formatCurrency(totalAmount)}/mo expected
        </p>
        <div className="mt-2 h-1.5 w-full bg-muted rounded-full">
          <div
            className="h-full bg-emerald-500 transition-all rounded-full"
            style={{ width: `${paidPct}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function dueBadgeClass(days: number) {
  if (days < 0) return "border-destructive bg-destructive/10 text-destructive";
  if (days <= 7) return "border-yellow-500 bg-yellow-50 text-yellow-700";
  return "border-emerald-500 bg-emerald-50 text-emerald-700";
}

function dueLabel(days: number) {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  return `Due in ${days}d`;
}

function RecurringTab({
  type,
  label,
}: {
  type: "subscription" | "bill" | "income";
  label: string;
}) {
  const { timezone } = useSettingsStore();
  const [showInactive, setShowInactive] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<RecurringItemOut | null>(null);
  const [form, setForm] = useState<RecurringFormState>(() => emptyForm(useSettingsStore.getState().timezone));
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [markPaidId, setMarkPaidId] = useState<string | null>(null);
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [paidDate, setPaidDate] = useState(() => todayString(useSettingsStore.getState().timezone));
  const [paidAmount, setPaidAmount] = useState("");
  const [paidDescription, setPaidDescription] = useState("");
  const [paidAccountId, setPaidAccountId] = useState("none");
  const [paidCategoryId, setPaidCategoryId] = useState("none");
  const [paidSourceAccountId, setPaidSourceAccountId] = useState("none");
  const [paidError, setPaidError] = useState<string | null>(null);
  const [confirmNoTxn, setConfirmNoTxn] = useState(false);

  const { data: items = [], isLoading, isError } = useRecurring(type, !showInactive);
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: expenseAccounts = [] } = useExpenseAccounts();

  const createRecurring = useCreateRecurring();
  const deleteRecurring = useDeleteRecurring();
  const markPaid = useMarkPaid();
  const markPaidNoTxn = useMarkPaidNoTransaction();

  const recurringList = items;

  function openAdd() {
    setEditItem(null);
    setForm({ ...emptyForm(timezone), type });
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(item: RecurringItemOut) {
    setEditItem(item);
    const isVariable = item.amount_min != null && item.amount_max != null;
    setForm({
      name: item.name,
      amount: String(item.amount),
      amount_min: item.amount_min != null ? String(item.amount_min) : "",
      amount_max: item.amount_max != null ? String(item.amount_max) : "",
      is_variable: isVariable,
      type: item.type,
      frequency: item.frequency,
      start_date: item.next_due_date,
      account_id: item.account_id || "none",
      category_id: item.category_id || "none",
      notes: item.notes ?? "",
      auto_match: item.auto_match ?? false,
      keyword_match: item.keyword_match ?? "",
      expense_account_id: item.expense_account_id ?? "none",
    });
    setFormError(null);
    setFormOpen(true);
  }

  const updateRecurring = useUpdateRecurring(editItem?.id ?? ""); // always called to satisfy rules of hooks

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) { setFormError("Name is required."); return; }
    if (form.is_variable) {
      const min = parseFloat(form.amount_min);
      const max = parseFloat(form.amount_max);
      if (!form.amount_min || isNaN(min) || min <= 0) { setFormError("Valid minimum amount is required."); return; }
      if (!form.amount_max || isNaN(max) || max <= 0) { setFormError("Valid maximum amount is required."); return; }
      if (max <= min) { setFormError("Maximum must be greater than minimum."); return; }
    } else {
      if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) {
        setFormError("Valid amount is required."); return;
      }
    }
    if (form.account_id === "none") { setFormError("Please select an account."); return; }
    try {
      const min = form.is_variable ? parseFloat(form.amount_min) : null;
      const max = form.is_variable ? parseFloat(form.amount_max) : null;
      const payload: RecurringCreateInput = {
        name: form.name,
        amount: form.is_variable ? (min! + max!) / 2 : parseFloat(form.amount),
        amount_min: min,
        amount_max: max,
        type: form.type,
        frequency: form.frequency,
        next_due_date: form.start_date,
        account_id: form.account_id,
        category_id: form.category_id === "none" ? null : form.category_id,
        expense_account_id: form.expense_account_id === "none" ? null : form.expense_account_id,
        auto_match: form.auto_match,
        keyword_match: form.keyword_match.trim() || null,
        notes: form.notes || null,
      };
      if (editItem) {
        await updateRecurring.mutateAsync(payload);
      } else {
        await createRecurring.mutateAsync(payload);
      }
      setFormOpen(false);
    } catch {
      setFormError("Failed to save. Please try again.");
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    await deleteRecurring.mutateAsync(deleteId);
    setDeleteOpen(false);
    setDeleteId(null);
  }

  async function handleMarkPaidNoTransaction() {
    if (!markPaidId) return;
    try {
      await markPaidNoTxn.mutateAsync({
        id: markPaidId,
        date: paidDate,
        amount: paidAmount ? parseFloat(paidAmount) : undefined,
      });
      setMarkPaidOpen(false);
      setMarkPaidId(null);
      setConfirmNoTxn(false);
    } catch {
      setPaidError("Failed to mark as paid. Please try again.");
    }
  }

  async function handleMarkPaid() {
    if (!markPaidId) return;
    setPaidError(null);
    const isMortgage = accounts.find((a) => a.id === paidAccountId)?.type === "mortgage";
    if (isMortgage && paidSourceAccountId === "none") {
      setPaidError("Please select a source account for mortgage payments.");
      return;
    }
    try {
      await markPaid.mutateAsync({
        id: markPaidId,
        date: paidDate,
        amount: paidAmount ? parseFloat(paidAmount) : undefined,
        description: paidDescription || undefined,
        account_id: paidAccountId !== "none" ? paidAccountId : undefined,
        category_id: paidCategoryId !== "none" ? paidCategoryId : null,
        source_account_id: isMortgage && paidSourceAccountId !== "none" ? paidSourceAccountId : undefined,
      });
      setMarkPaidOpen(false);
      setMarkPaidId(null);
    } catch {
      setPaidError("Failed to record payment. Please try again.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{recurringList.length} {label.toLowerCase()}</span>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => setShowInactive((v) => !v)}
          >
            {showInactive ? "Show Active Only" : "Show Inactive"}
          </Button>
        </div>
        <Button size="sm" onClick={openAdd} className="flex items-center gap-1">
          <Plus className="h-4 w-4" />
          Add {label.endsWith("s") ? label.slice(0, -1) : label}
        </Button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-4 py-3">
          Failed to load {label.toLowerCase()}.
        </div>
      ) : recurringList.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No {label.toLowerCase()} found. Add one to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {recurringList.map((item) => (
            <RecurringCard
              key={item.id}
              item={item}
              onEdit={() => openEdit(item)}
              onDelete={() => { setDeleteId(item.id); setDeleteOpen(true); }}
              onMarkPaid={() => {
                setMarkPaidId(item.id);
                setPaidDate(todayString(timezone));
                setPaidAmount(String(item.amount));
                setPaidDescription(item.name);
                setPaidAccountId(item.account_id || "none");
                setPaidCategoryId(item.category_id || "none");
                const isMtg = accounts.find((a) => a.id === item.account_id)?.type === "mortgage";
                const firstPayable = isMtg
                  ? accounts.find((a) => PAYABLE_ACCOUNT_TYPES.includes(a.type))
                  : undefined;
                setPaidSourceAccountId(firstPayable?.id ?? "none");
                setPaidError(null);
                setMarkPaidOpen(true);
              }}
            />
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md flex flex-col top-4 bottom-4 translate-y-0 sm:bottom-auto sm:top-[50svh] sm:-translate-y-1/2 sm:max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>{editItem ? "Edit" : "Add"} {label.slice(0, -1)}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
            <div className="overflow-y-auto flex-1 min-h-0">
            <div className="space-y-4 py-2">
              {formError && (
                <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-3 py-2">
                  {formError}
                </div>
              )}
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  placeholder="e.g. Netflix"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Amount ($)</Label>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, is_variable: !form.is_variable, amount: "", amount_min: "", amount_max: "" })}
                    className={cn(
                      "text-xs px-2 py-0.5 rounded-full border transition-colors",
                      form.is_variable
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-muted-foreground/30 text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    Variable range
                  </button>
                </div>
                {form.is_variable ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="Min"
                      value={form.amount_min}
                      onChange={(e) => setForm({ ...form, amount_min: e.target.value })}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="Max"
                      value={form.amount_max}
                      onChange={(e) => setForm({ ...form, amount_max: e.target.value })}
                    />
                  </div>
                ) : (
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                )}
              </div>
              <div className="space-y-1">
                <Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v as RecurringFrequency })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Bi-weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="semiannually">Semi-annually</SelectItem>
                    <SelectItem value="annually">Annually</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Next Due / Start Date</Label>
                <Input
                  type="date"
                  className="w-full"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Account</Label>
                  <SearchableSelect
                    value={form.account_id}
                    onValueChange={(v) => setForm({ ...form, account_id: v })}
                    options={[
                      { value: "none", label: "None" },
                      ...accounts.filter((a) => PAYABLE_ACCOUNT_TYPES.includes(a.type)).map((a) => ({ value: a.id, label: a.name })),
                    ]}
                    placeholder="Select…"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Category</Label>
                  <SearchableSelect
                    value={form.category_id}
                    onValueChange={(v) => setForm({ ...form, category_id: v })}
                    options={[
                      { value: "none", label: "None" },
                      ...[...categories]
                        .filter((c) => c.type === (form.type === "income" ? "income" : "expense"))
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((c) => ({ value: c.id, label: c.name })),
                    ]}
                    placeholder="Select…"
                  />
                </div>
              </div>
              {form.type !== "income" && (
                <div className="space-y-1">
                  <Label>Expense Account</Label>
                  <SearchableSelect
                    value={form.expense_account_id}
                    onValueChange={(v) => setForm({ ...form, expense_account_id: v })}
                    options={[
                      { value: "none", label: "None" },
                      ...expenseAccounts.filter((ea) => ea.is_active).sort((a, b) => a.name.localeCompare(b.name)).map((ea) => ({ value: ea.id, label: ea.name })),
                    ]}
                    placeholder="None"
                  />
                </div>
              )}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Auto-match transactions</Label>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, auto_match: !form.auto_match })}
                    className={cn(
                      "text-xs px-2 py-0.5 rounded-full border transition-colors",
                      form.auto_match
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-muted-foreground/30 text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    {form.auto_match ? "Enabled" : "Disabled"}
                  </button>
                </div>
                {form.auto_match && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Keywords (comma-separated; supports * and ? wildcards)
                    </Label>
                    <Input
                      placeholder="e.g. Netflix, AMZN*, *PRIME*"
                      value={form.keyword_match}
                      onChange={(e) => setForm({ ...form, keyword_match: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      New transactions whose description matches a keyword and amount falls within the configured range will be auto-linked and marked paid. Plain keywords match anywhere in the description. Use * (any characters) or ? (one character) for wildcard matching — e.g. <span className="font-mono">AMZN*</span> matches descriptions starting with "AMZN", <span className="font-mono">*PRIME*</span> matches any description containing "PRIME".
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input
                  placeholder="Optional"
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
              <Button type="submit" disabled={createRecurring.isPending || updateRecurring.isPending}>
                {createRecurring.isPending || updateRecurring.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this item?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This cannot be undone.</p>
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteRecurring.isPending}>
              {deleteRecurring.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark as Paid Dialog */}
      <Dialog open={markPaidOpen} onOpenChange={(open) => { setMarkPaidOpen(open); if (!open) setConfirmNoTxn(false); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-md flex flex-col top-4 bottom-4 translate-y-0 sm:bottom-auto sm:top-[50svh] sm:-translate-y-1/2 sm:max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Mark as Paid</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 min-h-0">
          {(() => {
            const isMortgage = accounts.find((a) => a.id === paidAccountId)?.type === "mortgage";
            const mortgageName = isMortgage ? accounts.find((a) => a.id === paidAccountId)?.name : null;
            return (
              <div className="space-y-4 py-2">
                {paidError && (
                  <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-3 py-2">
                    {paidError}
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Payment Date</Label>
                  <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Amount Paid ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Description</Label>
                  <Input
                    value={paidDescription}
                    onChange={(e) => setPaidDescription(e.target.value)}
                    placeholder="e.g. Netflix"
                  />
                </div>
                {isMortgage ? (
                  <>
                    <div className="space-y-1">
                      <Label>Mortgage Account</Label>
                      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                        {mortgageName}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>Pay From Account</Label>
                      <SearchableSelect
                        value={paidSourceAccountId}
                        onValueChange={setPaidSourceAccountId}
                        options={accounts
                          .filter((a) => PAYABLE_ACCOUNT_TYPES.includes(a.type))
                          .map((a) => ({ value: a.id, label: a.name }))}
                        placeholder="Select source account"
                      />
                    </div>
                  </>
                ) : (
                  <div className="space-y-1">
                    <Label>Account</Label>
                    <SearchableSelect
                      value={paidAccountId}
                      onValueChange={setPaidAccountId}
                      options={accounts
                        .filter((a) => PAYABLE_ACCOUNT_TYPES.includes(a.type))
                        .map((a) => ({ value: a.id, label: a.name }))}
                      placeholder="Select account"
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Category</Label>
                  <SearchableSelect
                    value={paidCategoryId}
                    onValueChange={setPaidCategoryId}
                    options={[
                      { value: "none", label: "Uncategorized" },
                      ...categories
                        .slice()
                        .filter((c) => c.type === (type === "income" ? "income" : "expense"))
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((c) => ({ value: c.id, label: c.name })),
                    ]}
                    placeholder="Uncategorized"
                  />
                </div>
              </div>
            );
          })()}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col pt-4">
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={handleMarkPaid} disabled={markPaid.isPending}>
                {markPaid.isPending ? "Saving…" : "Mark Paid"}
              </Button>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1 border-t">
              {confirmNoTxn ? (
                <>
                  <span className="text-xs text-muted-foreground">No transaction will be created.</span>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmNoTxn(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleMarkPaidNoTransaction} disabled={markPaidNoTxn.isPending}>
                    {markPaidNoTxn.isPending ? "Saving…" : "Confirm"}
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" className="text-muted-foreground" onClick={() => setConfirmNoTxn(true)}>
                  Mark Paid Without Transaction
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RecurringCard({
  item,
  onEdit,
  onDelete,
  onMarkPaid,
}: {
  item: RecurringItemOut;
  onEdit: () => void;
  onDelete: () => void;
  onMarkPaid: () => void;
}) {
  const updateRecurring = useUpdateRecurring(item.id);
  const navigate = useNavigate();
  const expected = item.expected_payments_this_month ?? 1;
  const paid = item.paid_payments_this_month ?? 0;
  const isPaid = paid >= expected;
  const actionLabel = item.type === "income" ? "received" : "paid";

  async function handleToggle() {
    await updateRecurring.mutateAsync({ is_active: !item.is_active });
  }

  return (
    <Card className={cn("relative", !item.is_active && "opacity-60")}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-snug">{item.name}</CardTitle>
          {isPaid ? (
            <Badge variant="outline" className="border-emerald-500 bg-emerald-50 text-emerald-700 text-xs shrink-0">
              Paid
            </Badge>
          ) : (
            <Badge variant="outline" className={cn("text-xs shrink-0", dueBadgeClass(item.days_until_due))}>
              {dueLabel(item.days_until_due)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          {item.amount_min != null && item.amount_max != null ? (
            <div>
              <span className="text-2xl font-bold">
                {formatCurrency(item.amount_min)}–{formatCurrency(item.amount_max)}
              </span>
              <span className="ml-1.5 text-xs text-muted-foreground">
                ~{formatCurrency(item.amount)} avg
              </span>
            </div>
          ) : (
            <span className="text-2xl font-bold">{formatCurrency(item.amount)}</span>
          )}
          <span className="text-xs text-muted-foreground">
            {FREQUENCY_LABELS[item.frequency] ?? item.frequency}
          </span>
        </div>
        {isPaid ? (
          <div className="flex items-center justify-between text-xs">
            <span className="text-emerald-600 font-medium">
              {formatCurrency(item.last_paid_amount ?? item.amount)} paid
              {item.last_paid_date ? ` · ${formatDate(item.last_paid_date)}` : ""}
            </span>
            {item.last_paid_transaction_id && (
              <button
                className="text-primary hover:underline underline-offset-2"
                onClick={() => navigate("/transactions")}
              >
                View →
              </button>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            Next due: {formatDate(item.next_due_date)}
          </div>
        )}
        {expected > 1 && (
          <div className="text-xs text-muted-foreground">
            {paid} of {expected} {actionLabel} this month
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs h-8 flex items-center gap-1"
            onClick={onMarkPaid}
            disabled={!item.is_active || isPaid}
          >
            <CheckCircle className="h-3.5 w-3.5" />
            Mark Paid
          </Button>
          {item.category_id && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs h-8"
              onClick={() => navigate(`/transactions?category_id=${item.category_id}`)}
            >
              {item.type === "subscription" ? "View Subs" : "View Bills"}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleToggle}
            disabled={updateRecurring.isPending}
            title={item.is_active ? "Deactivate" : "Activate"}
          >
            {item.is_active ? (
              <ToggleRight className="h-4 w-4 text-emerald-600" />
            ) : (
              <ToggleLeft className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const VALID_TABS = ["subscription", "bill", "income"] as const;
type RecurringTabValue = (typeof VALID_TABS)[number];

export default function RecurringPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<RecurringTabValue>("bill");

  // Honor /recurring?tab=<value> when arriving from the global search.
  // Fires once per navigation; param is cleared after consumption.
  const consumedTab = useRef(false);
  useEffect(() => {
    if (consumedTab.current) return;
    const t = searchParams.get("tab");
    if (t && (VALID_TABS as readonly string[]).includes(t)) {
      consumedTab.current = true;
      // Intentional one-time hydration from a navigation-only URL parameter.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab(t as RecurringTabValue);
      const next = new URLSearchParams(searchParams);
      next.delete("tab");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Recurring</h1>
        <p className="text-muted-foreground text-sm">Manage subscriptions, bills, and recurring income.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <RecurringSummaryCard type="bill" />
        <RecurringSummaryCard type="subscription" />
        <RecurringSummaryCard type="income" />
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as RecurringTabValue)}>
        <TabsList>
          <TabsTrigger value="subscription">Subscriptions</TabsTrigger>
          <TabsTrigger value="bill">Bills</TabsTrigger>
          <TabsTrigger value="income">Income</TabsTrigger>
        </TabsList>
        <TabsContent value="subscription" className="mt-4">
          <RecurringTab type="subscription" label="Subscriptions" />
        </TabsContent>
        <TabsContent value="bill" className="mt-4">
          <RecurringTab type="bill" label="Bills" />
        </TabsContent>
        <TabsContent value="income" className="mt-4">
          <RecurringTab type="income" label="Income" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
