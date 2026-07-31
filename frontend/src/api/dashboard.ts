import { useQuery } from "@tanstack/react-query";
import api from "./client";
import type { BudgetWithSpent } from "./budgets";
import type { CategoryOut } from "./categories";

type MoneyValue = number | string;

interface AccountBreakdownResponse {
  account_id: string;
  account_name: string;
  account_type: string;
  balance: MoneyValue;
  is_asset: boolean;
}

interface RecurringItemResponse {
  id: string;
  name: string;
  account_id: string;
  category_id: string | null;
  amount: MoneyValue;
  amount_min: MoneyValue | null;
  amount_max: MoneyValue | null;
  type: "bill" | "subscription" | "income";
  frequency: string;
  day_of_month: number | null;
  next_due_date: string;
  auto_post: boolean;
  auto_match: boolean;
  keyword_match: string | null;
  is_active: boolean;
  notes: string | null;
  days_until_due: number | null;
  last_paid_date: string | null;
  last_paid_amount: MoneyValue | null;
  last_paid_transaction_id: string | null;
  is_paid_current_period: boolean;
  expected_payments_this_month: number;
  paid_payments_this_month: number;
  expense_account_id: string | null;
}

interface TransactionResponse {
  id: string;
  account_id: string;
  category_id: string | null;
  transfer_account_id: string | null;
  recurring_item_id: string | null;
  expense_account_id: string | null;
  paired_transaction_id: string | null;
  amount: MoneyValue;
  type: "income" | "expense" | "transfer";
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

interface BudgetWithSpentResponse extends Omit<BudgetWithSpent, "amount" | "actual_spent" | "remaining"> {
  amount: MoneyValue;
  actual_spent: MoneyValue;
  remaining: MoneyValue;
}

interface DashboardSummaryResponse {
  net_worth: {
    total_assets: MoneyValue;
    total_liabilities: MoneyValue;
    net_worth: MoneyValue;
    accounts: AccountBreakdownResponse[];
  };
  monthly_spending: {
    current_month: MoneyValue;
    prev_month: MoneyValue;
    budget_total: MoneyValue;
    current_month_income: MoneyValue;
    non_bill_spending: MoneyValue;
  };
  upcoming_bills: RecurringItemResponse[];
  recent_transactions: TransactionResponse[];
  over_budget_alerts: BudgetWithSpentResponse[];
}

export interface DashboardRecurringItem extends Omit<RecurringItemResponse, "amount" | "amount_min" | "amount_max" | "last_paid_amount" | "days_until_due"> {
  amount: number;
  amount_min: number | null;
  amount_max: number | null;
  last_paid_amount: number | null;
  days_until_due: number;
}

export interface DashboardTransaction extends Omit<TransactionResponse, "amount"> {
  amount: number;
  category_name: string | null;
}

export interface DashboardSummary {
  net_worth: {
    total_assets: number;
    total_liabilities: number;
    net_worth: number;
    accounts: Array<Omit<AccountBreakdownResponse, "balance"> & { balance: number }>;
  };
  monthly_spending: {
    current_month: number;
    prev_month: number;
    budget_total: number;
    current_month_income: number;
    non_bill_spending: number;
  };
  upcoming_bills: DashboardRecurringItem[];
  recent_transactions: DashboardTransaction[];
  over_budget_alerts: BudgetWithSpent[];
}

const nullableNumber = (value: MoneyValue | null): number | null =>
  value == null ? null : Number(value);

function normalizeDashboard(data: DashboardSummaryResponse): DashboardSummary {
  return {
    net_worth: {
      total_assets: Number(data.net_worth.total_assets),
      total_liabilities: Number(data.net_worth.total_liabilities),
      net_worth: Number(data.net_worth.net_worth),
      accounts: data.net_worth.accounts.map((account) => ({
        ...account,
        balance: Number(account.balance),
      })),
    },
    monthly_spending: {
      current_month: Number(data.monthly_spending.current_month),
      prev_month: Number(data.monthly_spending.prev_month),
      budget_total: Number(data.monthly_spending.budget_total),
      current_month_income: Number(data.monthly_spending.current_month_income),
      non_bill_spending: Number(data.monthly_spending.non_bill_spending),
    },
    upcoming_bills: data.upcoming_bills.map((bill) => ({
      ...bill,
      amount: Number(bill.amount),
      amount_min: nullableNumber(bill.amount_min),
      amount_max: nullableNumber(bill.amount_max),
      last_paid_amount: nullableNumber(bill.last_paid_amount),
      days_until_due: bill.days_until_due ?? 0,
    })),
    recent_transactions: data.recent_transactions.map((transaction) => ({
      ...transaction,
      amount: Number(transaction.amount),
      category_name: transaction.category?.name ?? null,
    })),
    over_budget_alerts: data.over_budget_alerts.map((budget) => ({
      ...budget,
      amount: Number(budget.amount),
      actual_spent: Number(budget.actual_spent),
      remaining: Number(budget.remaining),
    })),
  };
}

export function useDashboard() {
  return useQuery<DashboardSummary>({
    queryKey: ["dashboard"],
    queryFn: async () => normalizeDashboard((await api.get<DashboardSummaryResponse>("/dashboard/summary")).data),
    refetchInterval: 60_000,
  });
}
