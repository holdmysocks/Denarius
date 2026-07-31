import { useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  useSpendingByCategory,
  useIncomeVsExpense,
  useMonthlyTrend,
  useCashFlow,
  type SpendingByCategory,
  type MonthlyIncomeExpense,
  type MonthlyTrend,
} from "@/api/reports";
import { formatCurrency, formatMonth, todayString } from "@/lib/utils";
import { useSettingsStore } from "@/store/settingsStore";

const PIE_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#84cc16",
  "#06b6d4", "#a78bfa",
];

function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
      {message}
    </div>
  );
}

interface DateRange {
  start_date: string;
  end_date: string;
}

function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (v: DateRange) => void;
}) {
  return (
    <div className="flex items-end gap-3 flex-wrap">
      <div className="space-y-1">
        <Label className="text-xs">From</Label>
        <Input
          type="date"
          className="w-36"
          value={value.start_date}
          onChange={(e) => onChange({ ...value, start_date: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">To</Label>
        <Input
          type="date"
          className="w-36"
          value={value.end_date}
          onChange={(e) => onChange({ ...value, end_date: e.target.value })}
        />
      </div>
    </div>
  );
}

// ---- Spending by Category Tab ----
function SpendingTab({ dateRange }: { dateRange: DateRange }) {
  const params = {
    ...(dateRange.start_date ? { start_date: dateRange.start_date } : {}),
    ...(dateRange.end_date ? { end_date: dateRange.end_date } : {}),
  };
  const { data, isLoading } = useSpendingByCategory(params);

  const items = data ?? [];
  const total = items.reduce((sum, item) => sum + item.total, 0);

  if (isLoading) return <Spinner />;
  if (items.length === 0) return <EmptyChart message="No spending data for this period." />;

  const pieData = items.map((item: SpendingByCategory) => ({
    name: item.category_name,
    value: item.total,
    pct: total > 0 ? ((item.total / total) * 100).toFixed(1) : "0",
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Spending by Category</CardTitle>
          <CardDescription className="text-xs">Total: {formatCurrency(total)}</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={110}
                innerRadius={55}
                paddingAngle={2}
              >
                {pieData.map((_, idx) => (
                  <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => formatCurrency(value)}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {pieData.map((item, idx) => (
              <div key={item.name} className="flex items-center gap-3">
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium truncate">{item.name}</span>
                    <span className="shrink-0 ml-2 text-muted-foreground">{item.pct}%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${item.pct}%`,
                        backgroundColor: PIE_COLORS[idx % PIE_COLORS.length],
                      }}
                    />
                  </div>
                </div>
                <span className="text-sm font-semibold shrink-0">{formatCurrency(item.value)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Income vs Expense Tab ----
function IncomeVsExpenseTab({ dateRange }: { dateRange: DateRange }) {
  const params = {
    ...(dateRange.start_date ? { start_date: dateRange.start_date } : {}),
    ...(dateRange.end_date ? { end_date: dateRange.end_date } : {}),
  };
  const { data, isLoading } = useIncomeVsExpense(params);

  const items = data ?? [];

  if (isLoading) return <Spinner />;
  if (items.length === 0) return <EmptyChart message="No income or expense data for this period." />;

  const chartData = items.map((item: MonthlyIncomeExpense) => ({
    month: formatMonth(item.month),
    Income: item.income,
    Expenses: item.expenses,
    Net: item.net,
  }));

  const totalIncome = items.reduce((sum, item) => sum + item.income, 0);
  const totalExpense = items.reduce((sum, item) => sum + item.expenses, 0);
  const net = totalIncome - totalExpense;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Total Income</p>
            <p className="text-xl font-bold text-emerald-600">{formatCurrency(totalIncome)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Total Expenses</p>
            <p className="text-xl font-bold text-destructive">{formatCurrency(totalExpense)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Net</p>
            <p className={`text-xl font-bold ${net >= 0 ? "text-emerald-600" : "text-destructive"}`}>
              {formatCurrency(net)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Income vs Expenses by Month</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                width={55}
              />
              <Tooltip
                formatter={(value: number) => formatCurrency(value)}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Income" fill="#10b981" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Expenses" fill="#ef4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Trends Tab ----
function TrendsTab() {
  const { data, isLoading } = useMonthlyTrend(24);

  const items = data ?? [];

  if (isLoading) return <Spinner />;
  if (items.length === 0) return <EmptyChart message="Not enough data to show trends." />;

  const chartData = items.map((item: MonthlyTrend) => ({
    month: formatMonth(item.month),
    Expenses: item.total,
  }));

  const avg = items.length > 0
    ? items.reduce((sum, item) => sum + item.total, 0) / items.length
    : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-5 pb-4 flex items-center gap-8">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Monthly Avg Spending</p>
            <p className="text-xl font-bold">{formatCurrency(avg)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Months Tracked</p>
            <p className="text-xl font-bold">{items.length}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Monthly Expense Trend</CardTitle>
          <CardDescription className="text-xs">Last 24 months</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                width={55}
              />
              <Tooltip
                formatter={(value: number) => formatCurrency(value)}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Line
                type="monotone"
                dataKey="Expenses"
                stroke="#ef4444"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Cash Flow Tab ----
function CashFlowTab({ dateRange }: { dateRange: DateRange }) {
  const params = {
    ...(dateRange.start_date ? { start_date: dateRange.start_date } : {}),
    ...(dateRange.end_date ? { end_date: dateRange.end_date } : {}),
  };
  const { data, isLoading } = useCashFlow(params);

  const items = data?.by_month ?? [];

  if (isLoading) return <Spinner />;
  if (items.length === 0) return <EmptyChart message="No cash flow data for this period." />;

  const totalInflow = data?.total_income ?? 0;
  const totalOutflow = data?.total_expenses ?? 0;
  const netCashFlow = data?.net ?? 0;

  const chartData = items.map((item: MonthlyIncomeExpense) => ({
    month: formatMonth(item.month),
    Inflow: item.income,
    Outflow: item.expenses,
    Net: item.net,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Total Inflow</p>
            <p className="text-xl font-bold text-emerald-600">{formatCurrency(totalInflow)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Total Outflow</p>
            <p className="text-xl font-bold text-destructive">{formatCurrency(totalOutflow)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Net Cash Flow</p>
            <p className={`text-xl font-bold ${netCashFlow >= 0 ? "text-emerald-600" : "text-destructive"}`}>
              {formatCurrency(netCashFlow)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Monthly Cash Flow</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                width={55}
              />
              <Tooltip
                formatter={(value: number) => formatCurrency(value)}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Inflow" fill="#10b981" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Outflow" fill="#ef4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Main Page ----
function defaultDateRange(tz: string): DateRange {
  const today = todayString(tz);
  const [y, m] = today.split("-").map(Number);
  const startMonth = m - 11;
  const startYear = y + Math.floor((startMonth - 1) / 12);
  const normalizedMonth = ((startMonth - 1 + 120) % 12) + 1;
  const start = `${startYear}-${String(normalizedMonth).padStart(2, "0")}-01`;
  return { start_date: start, end_date: today };
}

export default function ReportsPage() {
  const [dateRange, setDateRange] = useState<DateRange>(() =>
    defaultDateRange(useSettingsStore.getState().timezone)
  );
  const [activeTab, setActiveTab] = useState("spending");

  const showDateRange = activeTab !== "trends";

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground text-sm">Visualize your financial data.</p>
        </div>
        {showDateRange && (
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="spending">Spending</TabsTrigger>
          <TabsTrigger value="income-expense">Income vs Expense</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
        </TabsList>

        <TabsContent value="spending" className="mt-6">
          <SpendingTab dateRange={dateRange} />
        </TabsContent>

        <TabsContent value="income-expense" className="mt-6">
          <IncomeVsExpenseTab dateRange={dateRange} />
        </TabsContent>

        <TabsContent value="trends" className="mt-6">
          <TrendsTab />
        </TabsContent>

        <TabsContent value="cashflow" className="mt-6">
          <CashFlowTab dateRange={dateRange} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
