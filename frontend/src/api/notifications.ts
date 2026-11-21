import { useDashboard, type DashboardSummary } from "./dashboard";

export type NotificationSeverity = "info" | "warning" | "danger";

export interface Notification {
  id: string;
  title: string;
  subtitle?: string;
  severity: NotificationSeverity;
  link: string;
}

/** Bills/subscriptions due within this many days (or overdue) raise an alert. */
const DUE_SOON_DAYS = 3;

function describeDue(days: number): string {
  if (days < 0) {
    const overdue = Math.abs(days);
    return `overdue by ${overdue} day${overdue === 1 ? "" : "s"}`;
  }
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due in ${days} days`;
}

export function deriveNotifications(
  dashboard: Pick<DashboardSummary, "upcoming_bills" | "over_budget_alerts"> | undefined,
): Notification[] {
  const items: Notification[] = [];
  if (!dashboard) return items;

  for (const bill of dashboard.upcoming_bills) {
    // Income (e.g. a paycheck) is not something the user owes.
    if (bill.type === "income") continue;
    if (bill.days_until_due > DUE_SOON_DAYS) continue;
    items.push({
      id: `bill-${bill.id}`,
      title: bill.name,
      subtitle: `${describeDue(bill.days_until_due)} · $${Number(bill.amount).toFixed(2)}`,
      severity: bill.days_until_due <= 0 ? "danger" : "warning",
      link: "/recurring",
    });
  }

  for (const alert of dashboard.over_budget_alerts) {
    items.push({
      id: `budget-${alert.id}`,
      title: `${alert.category?.name ?? "Budget"} over limit`,
      subtitle: `Spent $${Number(alert.actual_spent).toFixed(2)} of $${Number(alert.amount).toFixed(2)}`,
      severity: "danger",
      link: "/budgets",
    });
  }

  return items;
}

export function useNotifications() {
  const { data } = useDashboard();
  const items = deriveNotifications(data);
  return { items, count: items.length };
}
