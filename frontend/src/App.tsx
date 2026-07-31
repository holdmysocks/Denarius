import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import AppShell from "@/components/layout/AppShell";
import ProtectedRoute from "@/components/layout/ProtectedRoute";

const LoginPage = lazy(() => import("@/pages/LoginPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const TransactionsPage = lazy(() => import("@/pages/TransactionsPage"));
const BudgetsPage = lazy(() => import("@/pages/BudgetsPage"));
const RecurringPage = lazy(() => import("@/pages/RecurringPage"));
const MortgagePage = lazy(() => import("@/pages/MortgagePage"));
const LoanPage = lazy(() => import("@/pages/LoanPage"));
const NetWorthPage = lazy(() => import("@/pages/NetWorthPage"));
const ReportsPage = lazy(() => import("@/pages/ReportsPage"));
const SettingsPage = lazy(() => import("@/pages/settings/SettingsPage"));
const AccountsPage = lazy(() => import("@/pages/AccountsPage"));
const ExpenseAccountsPage = lazy(() => import("@/pages/ExpenseAccountsPage"));
const CategoriesPage = lazy(() => import("@/pages/CategoriesPage"));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<DashboardPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/expense-accounts" element={<ExpenseAccountsPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/budgets" element={<BudgetsPage />} />
            <Route path="/recurring" element={<RecurringPage />} />
            <Route path="/mortgage" element={<MortgagePage />} />
            <Route path="/loans" element={<LoanPage />} />
            <Route path="/networth" element={<NetWorthPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
