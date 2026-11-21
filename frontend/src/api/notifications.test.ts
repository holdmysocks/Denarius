import { describe, expect, it, vi } from "vitest";

vi.mock("./dashboard", () => ({ useDashboard: vi.fn() }));

import { deriveNotifications } from "./notifications";
import type { DashboardRecurringItem } from "./dashboard";

function bill(overrides: Partial<DashboardRecurringItem>): DashboardRecurringItem {
  return {
    id: "b1",
    name: "Rent",
    amount: 1200,
    type: "bill",
    days_until_due: 0,
    next_due_date: "2026-11-21",
    ...overrides,
  } as DashboardRecurringItem;
}

describe("deriveNotifications", () => {
  it("returns nothing without dashboard data", () => {
    expect(deriveNotifications(undefined)).toEqual([]);
  });

  it("includes overdue bills as danger with an overdue message", () => {
    const [one, many] = deriveNotifications({
      upcoming_bills: [bill({ id: "a", days_until_due: -1 }), bill({ id: "b", days_until_due: -4 })],
      over_budget_alerts: [],
    });
    expect(one.severity).toBe("danger");
    expect(one.subtitle).toBe("overdue by 1 day · $1200.00");
    expect(many.subtitle).toMatch(/^overdue by 4 days/);
  });

  it("labels bills due soon and skips ones further out", () => {
    const items = deriveNotifications({
      upcoming_bills: [
        bill({ id: "t", days_until_due: 0 }),
        bill({ id: "m", days_until_due: 1 }),
        bill({ id: "s", days_until_due: 3 }),
        bill({ id: "f", days_until_due: 5 }),
      ],
      over_budget_alerts: [],
    });
    expect(items.map((i) => [i.id, i.severity, i.subtitle?.split(" · ")[0]])).toEqual([
      ["bill-t", "danger", "due today"],
      ["bill-m", "warning", "due tomorrow"],
      ["bill-s", "warning", "due in 3 days"],
    ]);
  });

  it("excludes income items such as paychecks", () => {
    const items = deriveNotifications({
      upcoming_bills: [bill({ name: "Paycheck", type: "income", days_until_due: 0 }), bill({ type: "subscription" })],
      over_budget_alerts: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Rent");
  });
});
