import { useState } from "react";
import { Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useAccounts } from "@/api/accounts";
import { useMortgage, useAmortization, useExtraPaymentCalc } from "@/api/mortgage";
import { formatCurrency, formatDate, todayString, cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settingsStore";

interface Account {
  id: string;
  name: string;
  type: string;
  current_balance: number;
}

interface LoanData {
  original_principal: number;
  interest_rate: number;
  term_months: number;
  start_date: string;
  extra_payment: number;
  loan_type?: string | null;
}

interface AmortizationRow {
  payment_number: number;
  payment_date: string;
  payment_amount: number;
  principal: number;
  interest: number;
  balance: number;
}

interface ExtraPaymentResult {
  months_saved: number;
  interest_saved: number;
  new_payoff_date: string;
}

const LOAN_TYPE_LABELS: Record<string, string> = {
  auto: "Auto Loan",
  student: "Student Loan",
  personal: "Personal Loan",
  business: "Business Loan",
  home_equity: "Home Equity Loan",
  other: "Other Loan",
};

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function LoanPage() {
  const { timezone } = useSettingsStore();
  const { data: accounts = [] } = useAccounts();
  const loanAccounts = (accounts as Account[]).filter((a) => a.type === "loan");

  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const accountId = selectedAccountId || (loanAccounts[0]?.id ?? "");

  const [extraInput, setExtraInput] = useState("");
  const [calcResult, setCalcResult] = useState<ExtraPaymentResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const extraCalc = useExtraPaymentCalc(accountId);

  type ViewMode = "first12" | "next12" | "all";
  const [viewMode, setViewMode] = useState<ViewMode>("first12");

  const { data: loanDetail, isLoading: loanLoading, isError: loanError } = useMortgage(accountId);
  const { data: amortizationData, isLoading: amorLoading } = useAmortization(accountId, 0);

  const loanInfo: LoanData | null = loanDetail ?? null;
  const allRows: AmortizationRow[] = Array.isArray(amortizationData) ? amortizationData : [];
  const selectedAccount = (accounts as Account[]).find((a) => a.id === accountId);
  const standardMonthlyPayment = allRows[0]?.payment_amount;

  const today = todayString(timezone);
  const nextIdx = allRows.findIndex((row) => row.payment_date >= today);
  const nextStart = nextIdx === -1 ? 0 : nextIdx;
  const displayedRows =
    viewMode === "all"
      ? allRows
      : viewMode === "next12"
      ? allRows.slice(nextStart, nextStart + 12)
      : allRows.slice(0, 12);

  async function handleCalc(e: React.FormEvent) {
    e.preventDefault();
    setCalcError(null);
    setCalcResult(null);
    const val = parseFloat(extraInput);
    if (isNaN(val) || val < 0) { setCalcError("Enter a valid amount (0 or more)."); return; }
    try {
      const result = await extraCalc.mutateAsync(val);
      setCalcResult(result);
    } catch {
      setCalcError("Failed to calculate. Ensure loan details are configured.");
    }
  }

  const loanTypeLabel = loanInfo?.loan_type ? LOAN_TYPE_LABELS[loanInfo.loan_type] ?? loanInfo.loan_type : null;

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Loans</h1>
        <p className="text-muted-foreground text-sm">Amortization details and extra payment analysis for your loans.</p>
      </div>

      {/* Account Selector */}
      <div className="flex items-center gap-3">
        <Label className="shrink-0">Loan Account</Label>
        {loanAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No loan accounts found. Add one in Settings.
          </p>
        ) : (
          <Select value={accountId} onValueChange={setSelectedAccountId}>
            <SelectTrigger className="w-60">
              <SelectValue placeholder="Select account…" />
            </SelectTrigger>
            <SelectContent>
              {loanAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {!accountId ? (
        <div className="text-center py-20 text-muted-foreground text-sm">
          Select a loan account to view details.
        </div>
      ) : loanLoading ? (
        <Spinner />
      ) : loanError || !loanInfo ? (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-4 py-3">
          No loan details found for this account. Please configure them in Settings.
        </div>
      ) : (
        <>
          {/* Loan type badge */}
          {loanTypeLabel && (
            <div>
              <Badge variant="secondary" className="text-xs">{loanTypeLabel}</Badge>
            </div>
          )}

          {/* Key Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label="Original Principal"
              value={formatCurrency(loanInfo.original_principal)}
              sub={`Started ${formatDate(loanInfo.start_date)}`}
            />
            <StatCard
              label="Current Balance"
              value={selectedAccount ? formatCurrency(selectedAccount.current_balance) : "—"}
              sub={`${loanInfo.term_months} month term`}
            />
            <StatCard
              label="Interest Rate"
              value={`${loanInfo.interest_rate}%`}
              sub="Annual rate"
            />
            <StatCard
              label="Monthly Payment"
              value={standardMonthlyPayment !== undefined ? formatCurrency(standardMonthlyPayment) : "—"}
              sub={
                allRows.length > 0
                  ? `Payoff ~${formatDate(allRows[allRows.length - 1].payment_date)}`
                  : undefined
              }
            />
          </div>

          {/* Extra Payment Calculator */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Calculator className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Extra Payment Calculator</CardTitle>
              </div>
              <CardDescription className="text-xs">
                See how much you can save by adding extra monthly payments.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCalc} className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label>Extra Monthly Payment ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    className="w-40"
                    value={extraInput}
                    onChange={(e) => setExtraInput(e.target.value)}
                  />
                </div>
                <Button type="submit" disabled={extraCalc.isPending}>
                  {extraCalc.isPending ? "Calculating…" : "Calculate"}
                </Button>
              </form>
              {calcError && (
                <div className="mt-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-3 py-2">
                  {calcError}
                </div>
              )}
              {calcResult && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="rounded-lg border bg-muted/40 p-4">
                    <p className="text-xs text-muted-foreground mb-1">Months Saved</p>
                    <p className="text-2xl font-bold text-emerald-600">{calcResult.months_saved}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-4">
                    <p className="text-xs text-muted-foreground mb-1">Interest Saved</p>
                    <p className="text-2xl font-bold text-emerald-600">{formatCurrency(calcResult.interest_saved)}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-4">
                    <p className="text-xs text-muted-foreground mb-1">New Payoff Date</p>
                    <p className="text-lg font-bold">{formatDate(calcResult.new_payoff_date)}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Amortization Table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Amortization Schedule</CardTitle>
                  <CardDescription className="text-xs">
                    {viewMode === "all"
                      ? `All ${allRows.length} payments`
                      : viewMode === "next12"
                      ? "Next 12 upcoming payments"
                      : "First 12 payments"}
                  </CardDescription>
                </div>
                {allRows.length > 12 && (
                  <div className="flex items-center rounded-md border overflow-hidden">
                    {(["first12", "next12", "all"] as ViewMode[]).map((mode, i) => (
                      <button
                        key={mode}
                        onClick={() => setViewMode(mode)}
                        className={cn(
                          "px-2.5 py-1 text-xs transition-colors",
                          i > 0 && "border-l",
                          viewMode === mode
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted"
                        )}
                      >
                        {mode === "first12" ? "First 12" : mode === "next12" ? "Next 12" : `All (${allRows.length})`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {amorLoading ? (
                <Spinner />
              ) : allRows.length === 0 ? (
                <p className="px-6 py-8 text-sm text-muted-foreground text-center">
                  Amortization schedule not available.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">#</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Payment</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Principal</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Interest</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedRows.map((row) => (
                        <tr
                          key={row.payment_number}
                          className={cn(
                            "border-b last:border-0 hover:bg-muted/30",
                            row.payment_number % 12 === 0 && "bg-muted/20"
                          )}
                        >
                          <td className="px-4 py-2.5 text-muted-foreground">{row.payment_number}</td>
                          <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{formatDate(row.payment_date)}</td>
                          <td className="px-4 py-2.5 text-right font-medium">{formatCurrency(row.payment_amount)}</td>
                          <td className="px-4 py-2.5 text-right text-emerald-700">{formatCurrency(row.principal)}</td>
                          <td className="px-4 py-2.5 text-right text-destructive">{formatCurrency(row.interest)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold">{formatCurrency(row.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
