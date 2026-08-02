import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Pencil,
  Plus,
  Scale,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  useForecast,
  useExtraExpenses,
  useCreateExtraExpense,
  useUpdateExtraExpense,
  useDeleteExtraExpense,
  type ExtraExpenseFrequency,
  type ExtraExpenseOut,
  type ForecastGroup,
} from "@/api/forecast";
import { formatCurrency, cn } from "@/lib/utils";

type Period = "monthly" | "yearly";

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Yearly",
  yearly: "Yearly",
};

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

interface ExtraFormState {
  name: string;
  amount: string;
  frequency: ExtraExpenseFrequency;
  notes: string;
}

const emptyExtraForm: ExtraFormState = {
  name: "",
  amount: "",
  frequency: "monthly",
  notes: "",
};

function groupTotal(group: ForecastGroup, period: Period) {
  return period === "monthly" ? group.monthly_total : group.yearly_total;
}

/** One collapsible income/expense group with its contributing rows. */
function GroupCard({
  group,
  period,
  tone,
}: {
  group: ForecastGroup;
  period: Period;
  tone: "income" | "expense";
}) {
  const [open, setOpen] = useState(false);
  const total = groupTotal(group, period);
  const toneClass = tone === "income" ? "text-emerald-600" : "text-destructive";

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left"
        aria-expanded={open}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
          <div className="min-w-0">
            <CardTitle className="text-sm font-medium">{group.label}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {group.items.length} {group.items.length === 1 ? "item" : "items"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={cn("text-lg font-semibold tabular-nums", toneClass)}>
              {formatCurrency(total)}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </div>
        </CardHeader>
      </button>
      {open && (
        <CardContent className="pt-0">
          {group.items.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nothing here yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {group.items.map((item) => (
                  <tr key={`${item.source}-${item.id}`} className="border-b last:border-0">
                    <td className="py-2 pr-2">
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[
                          FREQUENCY_LABELS[item.frequency] ?? item.frequency,
                          item.category_name,
                          item.account_name,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </td>
                    <td className="py-2 text-right">
                      <div className="font-semibold tabular-nums">
                        {formatCurrency(
                          period === "monthly" ? item.monthly_amount : item.yearly_amount,
                        )}
                      </div>
                      {item.frequency !== period && (
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {formatCurrency(item.amount)} each
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function ForecastPage() {
  const [period, setPeriod] = useState<Period>("monthly");
  const [includeBudgets, setIncludeBudgets] = useState(false);

  const { data: forecast, isLoading, isError } = useForecast(includeBudgets);
  const { data: extras = [] } = useExtraExpenses();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExtraExpenseOut | null>(null);
  const [form, setForm] = useState<ExtraFormState>(emptyExtraForm);
  const [formError, setFormError] = useState<string | null>(null);

  const createExtra = useCreateExtraExpense();
  const updateExtra = useUpdateExtraExpense();
  const deleteExtra = useDeleteExtraExpense();
  const saving = createExtra.isPending || updateExtra.isPending;

  const income = forecast
    ? period === "monthly"
      ? forecast.income_monthly
      : forecast.income_yearly
    : 0;
  const expenses = forecast
    ? period === "monthly"
      ? forecast.expenses_monthly
      : forecast.expenses_yearly
    : 0;
  const net = forecast ? (period === "monthly" ? forecast.net_monthly : forecast.net_yearly) : 0;

  const savingsRate = useMemo(
    () => (income > 0 ? Math.round((net / income) * 100) : null),
    [income, net],
  );

  function openCreate() {
    setEditing(null);
    setForm(emptyExtraForm);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(extra: ExtraExpenseOut) {
    setEditing(extra);
    setForm({
      name: extra.name,
      amount: String(extra.amount),
      frequency: extra.frequency,
      notes: extra.notes ?? "",
    });
    setFormError(null);
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const amount = parseFloat(form.amount);
    if (!form.name.trim()) {
      setFormError("Name is required.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Amount must be greater than zero.");
      return;
    }
    const payload = {
      name: form.name.trim(),
      amount,
      frequency: form.frequency,
      notes: form.notes.trim() || null,
    };
    try {
      if (editing) {
        await updateExtra.mutateAsync({ id: editing.id, ...payload });
      } else {
        await createExtra.mutateAsync(payload);
      }
      setDialogOpen(false);
    } catch {
      setFormError("Failed to save. Please try again.");
    }
  }

  async function handleDelete(extra: ExtraExpenseOut) {
    if (!window.confirm(`Delete "${extra.name}"?`)) return;
    await deleteExtra.mutateAsync(extra.id);
  }

  if (isLoading) return <Spinner />;

  if (isError || !forecast) {
    return (
      <div className="p-3 sm:p-6">
        <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-4 py-3">
          Failed to load forecast data.
        </div>
      </div>
    );
  }

  const periodLabel = period === "monthly" ? "per month" : "per year";

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Forecast</h1>
          <p className="text-muted-foreground text-sm">
            Estimated income vs. expenses from your recurring items.
          </p>
        </div>
        <div className="flex gap-1 rounded-md border p-0.5">
          {(["monthly", "yearly"] as const).map((p) => (
            <Button
              key={p}
              variant={period === p ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-3 text-xs capitalize"
              onClick={() => setPeriod(p)}
            >
              {p}
            </Button>
          ))}
        </div>
      </div>

      {/* Headline net */}
      <Card className="border-2">
        <CardContent className="pt-8 pb-8 text-center">
          <p className="text-sm text-muted-foreground mb-2">
            Estimated net {periodLabel}
          </p>
          <p
            className={cn(
              "text-5xl font-extrabold tracking-tight tabular-nums",
              net >= 0 ? "text-emerald-600" : "text-destructive",
            )}
          >
            {formatCurrency(net)}
          </p>
          {savingsRate !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              {savingsRate}% of income {net >= 0 ? "left over" : "overspent"}
            </p>
          )}
          <div className="flex items-center justify-center gap-8 mt-4">
            <div>
              <p className="text-xs text-muted-foreground">Income</p>
              <p className="text-lg font-semibold text-emerald-600 tabular-nums">
                {formatCurrency(income)}
              </p>
            </div>
            <div className="text-muted-foreground text-xl font-light">−</div>
            <div>
              <p className="text-xs text-muted-foreground">Expenses</p>
              <p className="text-lg font-semibold text-destructive tabular-nums">
                {formatCurrency(expenses)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
            Income
          </h2>
          <GroupCard group={forecast.income} period={period} tone="income" />
        </div>
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
            Expenses
          </h2>
          {forecast.expense_groups.map((group) => (
            <GroupCard key={group.key} group={group} period={period} tone="expense" />
          ))}
        </div>
      </div>

      {/* Budget inclusion toggle */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="include-budgets" className="text-sm font-medium">
                Include category budgets as expenses
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Adds this month&apos;s budgeted amount for every category on top of the
                recurring totals.
              </p>
            </div>
            <Switch
              id="include-budgets"
              checked={includeBudgets}
              onCheckedChange={setIncludeBudgets}
            />
          </div>
          {includeBudgets && forecast.budget_overlap_count > 0 && (
            <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
              <span>
                {forecast.budget_overlap_count}{" "}
                {forecast.budget_overlap_count === 1 ? "category is" : "categories are"}{" "}
                budgeted <em>and</em> already covered by a recurring bill or subscription —
                that spend is counted twice here.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Extra expenses */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">Extra Expenses</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manual costs with no recurring item behind them. Counted in the totals above.
            </p>
          </div>
          <Button size="sm" variant="outline" className="gap-2 shrink-0" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </CardHeader>
        <CardContent>
          {extras.length === 0 ? (
            <EmptyState
              icon={<Scale />}
              title="No extra expenses"
              description="Add things like gas, groceries, or a monthly buffer to make the forecast realistic."
              className="py-10"
            />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {extras.map((extra) => (
                  <tr key={extra.id} className="border-b last:border-0">
                    <td className="py-2 pr-2">
                      <div className={cn("font-medium", !extra.is_active && "text-muted-foreground line-through")}>
                        {extra.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[FREQUENCY_LABELS[extra.frequency], extra.notes].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums whitespace-nowrap">
                      {formatCurrency(extra.amount)}
                    </td>
                    <td className="py-2 pl-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => openEdit(extra)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground"
                        aria-label={`Edit ${extra.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(extra)}
                        className="p-1 rounded text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${extra.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Extra Expense" : "Add Extra Expense"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-2">
              {formError && (
                <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-3 py-2">
                  {formError}
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="extra-name">Name</Label>
                <Input
                  id="extra-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Groceries"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="extra-amount">Amount</Label>
                <Input
                  id="extra-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="450.00"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Frequency</Label>
                <Select
                  value={form.frequency}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, frequency: v as ExtraExpenseFrequency }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Per month</SelectItem>
                    <SelectItem value="yearly">Per year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="extra-notes">Notes</Label>
                <Input
                  id="extra-notes"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            </div>
            <DialogFooter className="mt-4">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save Changes" : "Add Expense"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
