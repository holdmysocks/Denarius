import { useQuery } from "@tanstack/react-query";
import api from "./client";

type ApiMoney = number | string;

interface SpendingByCategoryResponse {
  category_id: string;
  category_name: string;
  color: string;
  total: ApiMoney;
  percentage: number;
}

interface MonthlyIncomeExpenseResponse {
  month: string;
  income: ApiMoney;
  expenses: ApiMoney;
  net: ApiMoney;
}

interface MonthlyTrendResponse {
  month: string;
  total: ApiMoney;
}

interface CashFlowReportResponse {
  total_income: ApiMoney;
  total_expenses: ApiMoney;
  net: ApiMoney;
  by_month: MonthlyIncomeExpenseResponse[];
}

export interface SpendingByCategory {
  category_id: string;
  category_name: string;
  color: string;
  total: number;
  percentage: number;
}

export interface MonthlyIncomeExpense {
  month: string;
  income: number;
  expenses: number;
  net: number;
}

export interface MonthlyTrend {
  month: string;
  total: number;
}

export interface CashFlowReport {
  total_income: number;
  total_expenses: number;
  net: number;
  by_month: MonthlyIncomeExpense[];
}

function money(value: ApiMoney): number {
  return Number(value);
}

function normalizeMonthlyIncomeExpense(item: MonthlyIncomeExpenseResponse): MonthlyIncomeExpense {
  return {
    ...item,
    income: money(item.income),
    expenses: money(item.expenses),
    net: money(item.net),
  };
}

export function useSpendingByCategory(params?: { start_date?: string; end_date?: string }) {
  return useQuery<SpendingByCategory[]>({
    queryKey: ["reports", "spending-by-category", params],
    queryFn: () =>
      api.get<SpendingByCategoryResponse[]>("/reports/spending-by-category", { params }).then((r) =>
        r.data.map((item) => ({ ...item, total: money(item.total) }))
      ),
  });
}

export function useIncomeVsExpense(params?: { start_date?: string; end_date?: string }) {
  return useQuery<MonthlyIncomeExpense[]>({
    queryKey: ["reports", "income-vs-expense", params],
    queryFn: () =>
      api.get<MonthlyIncomeExpenseResponse[]>("/reports/income-vs-expense", { params }).then((r) =>
        r.data.map(normalizeMonthlyIncomeExpense)
      ),
  });
}

export function useMonthlyTrend(months: number = 12, categoryId?: string) {
  return useQuery<MonthlyTrend[]>({
    queryKey: ["reports", "monthly-trend", months, categoryId],
    queryFn: () =>
      api.get<MonthlyTrendResponse[]>("/reports/monthly-trend", {
        params: { months, ...(categoryId ? { category_id: categoryId } : {}) },
      }).then((r) => r.data.map((item) => ({ ...item, total: money(item.total) }))),
  });
}

export function useCashFlow(params?: { start_date?: string; end_date?: string }) {
  return useQuery<CashFlowReport>({
    queryKey: ["reports", "cash-flow", params],
    queryFn: () =>
      api.get<CashFlowReportResponse>("/reports/cash-flow", { params }).then((r) => ({
        total_income: money(r.data.total_income),
        total_expenses: money(r.data.total_expenses),
        net: money(r.data.net),
        by_month: r.data.by_month.map(normalizeMonthlyIncomeExpense),
      })),
  });
}
