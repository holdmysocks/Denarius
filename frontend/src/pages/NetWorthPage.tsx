import { useState } from "react";
import { Camera } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  useNetWorthCurrent,
  useNetWorthHistory,
  useCreateSnapshot,
  type NetWorthAccount,
  type NetWorthCurrent,
  type NetWorthSnapshot,
} from "@/api/networth";
import { useAuthStore } from "@/store/authStore";
import { formatCurrency, formatMonth, todayString, cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settingsStore";

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

const TIME_RANGES = [
  { label: "1M", months: 1 },
  { label: "3M", months: 3 },
  { label: "6M", months: 6 },
  { label: "12M", months: 12 },
  { label: "24M", months: 24 },
] as const;

export default function NetWorthPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";

  const [months, setMonths] = useState(12);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotDate, setSnapshotDate] = useState(() => todayString(useSettingsStore.getState().timezone));
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const { data: current, isLoading: currLoading, isError: currError } = useNetWorthCurrent();
  const { data: history = [], isLoading: histLoading } = useNetWorthHistory(months);
  const createSnapshot = useCreateSnapshot();

  const currentData: NetWorthCurrent | null = current ?? null;
  const historyData: NetWorthSnapshot[] = history;

  const assets: NetWorthAccount[] = currentData?.accounts.filter((a) => a.is_asset) ?? [];
  const liabilities: NetWorthAccount[] = currentData?.accounts.filter((a) => !a.is_asset) ?? [];

  const chartData = historyData.map((h) => ({
    month: formatMonth(h.snapshot_date),
    "Net Worth": Math.round(h.net_worth),
    Assets: Math.round(h.total_assets),
    Liabilities: Math.round(h.total_liabilities),
  }));

  async function handleSnapshot(e: React.FormEvent) {
    e.preventDefault();
    setSnapshotError(null);
    try {
      await createSnapshot.mutateAsync(snapshotDate);
      setSnapshotOpen(false);
    } catch {
      setSnapshotError("Failed to create snapshot.");
    }
  }

  if (currLoading) return <Spinner />;

  if (currError) {
    return (
      <div className="p-3 sm:p-6">
        <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-4 py-3">
          Failed to load net worth data.
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Net Worth</h1>
          <p className="text-muted-foreground text-sm">Your complete financial picture.</p>
        </div>
        {isAdmin && (
          <Button variant="outline" size="sm" className="flex items-center gap-2" onClick={() => setSnapshotOpen(true)}>
            <Camera className="h-4 w-4" />
            Record Snapshot
          </Button>
        )}
      </div>

      {/* Big Number */}
      {currentData && (
        <Card className="border-2">
          <CardContent className="pt-8 pb-8 text-center">
            <p className="text-sm text-muted-foreground mb-2">Total Net Worth</p>
            <p
              className={cn(
                "text-5xl font-extrabold tracking-tight",
                currentData.net_worth >= 0 ? "text-emerald-600" : "text-destructive"
              )}
            >
              {formatCurrency(currentData.net_worth)}
            </p>
            <div className="flex items-center justify-center gap-8 mt-4">
              <div>
                <p className="text-xs text-muted-foreground">Assets</p>
                <p className="text-lg font-semibold text-emerald-600">
                  {formatCurrency(currentData.total_assets ?? 0)}
                </p>
              </div>
              <div className="text-muted-foreground text-xl font-light">−</div>
              <div>
                <p className="text-xs text-muted-foreground">Liabilities</p>
                <p className="text-lg font-semibold text-destructive">
                  {formatCurrency(currentData.total_liabilities ?? 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Asset / Liability Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Assets */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-emerald-700">Assets</CardTitle>
            <CardDescription className="text-xs">{formatCurrency(currentData?.total_assets ?? 0)} total</CardDescription>
          </CardHeader>
          <CardContent>
            {assets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No asset accounts.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {assets.map((a) => (
                    <tr key={a.account_id} className="border-b last:border-0">
                      <td className="py-2">
                        <div className="font-medium">{a.account_name}</div>
                        <div className="text-xs text-muted-foreground capitalize">{a.account_type}</div>
                      </td>
                      <td
                        className={cn(
                          "py-2 text-right font-semibold",
                          a.balance < 0 ? "text-destructive" : "text-emerald-700"
                        )}
                      >
                        {formatCurrency(a.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Liabilities */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-destructive">Liabilities</CardTitle>
            <CardDescription className="text-xs">{formatCurrency(currentData?.total_liabilities ?? 0)} total</CardDescription>
          </CardHeader>
          <CardContent>
            {liabilities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No liability accounts.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {liabilities.map((a) => (
                    <tr key={a.account_id} className="border-b last:border-0">
                      <td className="py-2">
                        <div className="font-medium">{a.account_name}</div>
                        <div className="text-xs text-muted-foreground capitalize">{a.account_type}</div>
                      </td>
                      <td
                        className={cn(
                          "py-2 text-right font-semibold",
                          a.balance < 0 ? "text-emerald-700" : "text-destructive"
                        )}
                      >
                        {formatCurrency(a.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Historical Chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base">Net Worth History</CardTitle>
          </div>
          <div className="flex gap-1">
            {TIME_RANGES.map(({ label, months: m }) => (
              <Button
                key={label}
                variant={months === m ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setMonths(m)}
              >
                {label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {histLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
            </div>
          ) : chartData.length < 2 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Not enough history to display a chart. Record more monthly snapshots.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) =>
                    Math.abs(v) >= 1000
                      ? `$${(v / 1000).toFixed(0)}k`
                      : `$${v}`
                  }
                  width={60}
                />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="Net Worth"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="Assets"
                  stroke="#6366f1"
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray="4 2"
                />
                <Line
                  type="monotone"
                  dataKey="Liabilities"
                  stroke="#ef4444"
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray="4 2"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Snapshot Dialog (admin only) */}
      {isAdmin && (
        <Dialog open={snapshotOpen} onOpenChange={setSnapshotOpen}>
          <DialogContent className="max-w-[95vw] sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Record Net Worth Snapshot</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSnapshot}>
              <div className="space-y-4 py-2">
                {snapshotError && (
                  <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-3 py-2">
                    {snapshotError}
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Snapshot Date</Label>
                  <Input
                    type="date"
                    value={snapshotDate}
                    onChange={(e) => setSnapshotDate(e.target.value)}
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  This will record the current account balances for the selected date.
                </p>
              </div>
              <DialogFooter className="mt-4">
                <DialogClose asChild>
                  <Button type="button" variant="outline">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={createSnapshot.isPending}>
                  {createSnapshot.isPending ? "Recording…" : "Record Snapshot"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
