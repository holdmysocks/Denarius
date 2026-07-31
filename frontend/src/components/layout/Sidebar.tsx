import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Target,
  RotateCcw,
  Home,
  Landmark,
  TrendingUp,
  BarChart3,
  Settings,
  Wallet,
  ShoppingCart,
  Tag,
  ChevronLeft,
  Moon,
  Sun,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { usePreferencesStore, isEffectiveDark } from "@/store/preferencesStore";
import { logout } from "@/api/auth";
import { Logo } from "@/components/ui/logo";
import { Avatar } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const PRIMARY: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { to: "/budgets", label: "Budgets", icon: Target },
  { to: "/recurring", label: "Recurring", icon: RotateCcw },
  { to: "/mortgage", label: "Mortgage", icon: Home },
  { to: "/loans", label: "Loans", icon: Landmark },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/networth", label: "Net Worth", icon: TrendingUp },
];

const ACCOUNTS: NavItem[] = [
  { to: "/accounts", label: "Asset Accounts", icon: Wallet },
  { to: "/expense-accounts", label: "Expense Accounts", icon: ShoppingCart },
  { to: "/categories", label: "Categories", icon: Tag },
];

interface SidebarProps {
  mobile?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ mobile = false, onClose }: SidebarProps) {
  const collapsedPref = usePreferencesStore((s) => s.sidebarCollapsed);
  const setCollapsed = usePreferencesStore((s) => s.setSidebarCollapsed);
  const sidebarStyle = usePreferencesStore((s) => s.sidebarStyle);
  const theme = usePreferencesStore((s) => s.theme);
  const toggleTheme = usePreferencesStore((s) => s.toggleTheme);
  const user = useAuthStore((s) => s.user);

  const collapsed = mobile ? false : sidebarStyle === "minimal" ? true : collapsedPref;
  const isDark = isEffectiveDark(theme);
  const showCollapseToggle = !mobile && sidebarStyle !== "minimal";

  const handleLogout = async () => {
    await logout();
  };

  const renderNav = (items: NavItem[]) =>
    items.map((item) => {
      const Icon = item.icon;
      const link = (
        <NavLink
          to={item.to}
          end={item.end}
          onClick={mobile ? onClose : undefined}
          className={({ isActive }) =>
            cn(
              "mx-2 flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors border-l-2 border-transparent",
              collapsed && "justify-center px-0",
              isActive
                ? "bg-[var(--ea-accent-soft)] text-[var(--ea-accent-700)] dark:bg-[var(--ea-accent)]/15 dark:text-[var(--ea-accent)] border-l-2 border-[var(--ea-accent)]"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
        </NavLink>
      );
      if (collapsed) {
        return (
          <Tooltip key={item.to}>
            <TooltipTrigger asChild>
              <span className="block">{link}</span>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        );
      }
      return <div key={item.to}>{link}</div>;
    });

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "flex flex-col shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-[width] duration-200",
          collapsed ? "w-16" : "w-60",
          mobile ? "h-full" : "hidden md:flex h-dvh sticky top-0",
          !mobile && sidebarStyle === "floating" && "m-2 rounded-xl shadow-lg border h-[calc(100dvh-1rem)] sticky top-2",
        )}
      >
        <div
          className={cn(
            "h-14 flex items-center border-b border-sidebar-border px-3 shrink-0",
            collapsed ? "justify-center" : "justify-between",
          )}
        >
          {collapsed ? <Logo showWordmark={false} size={28} /> : <Logo size={28} />}
          {!collapsed && showCollapseToggle && (
            <button
              onClick={() => setCollapsed(true)}
              className="p-1 rounded hover:bg-sidebar-accent text-muted-foreground"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto py-3">
          <nav className="space-y-0.5">{renderNav(PRIMARY)}</nav>

          <div className="mt-4">
            {!collapsed && (
              <div className="px-4 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Accounts
              </div>
            )}
            {collapsed && <div className="border-t border-sidebar-border mx-2 my-2" />}
            <nav className="space-y-0.5">{renderNav(ACCOUNTS)}</nav>
          </div>

          <div className="mt-4">
            <nav className="space-y-0.5">{renderNav([{ to: "/settings", label: "Settings", icon: Settings }])}</nav>
          </div>
        </div>

        <div className="border-t border-sidebar-border p-2 space-y-1 shrink-0">
          <button
            onClick={toggleTheme}
            className={cn(
              "w-full flex items-center gap-3 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent",
              collapsed && "justify-center",
            )}
            title={`Theme: ${theme}`}
          >
            {isDark ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
            {!collapsed && <span className="truncate">{isDark ? "Light mode" : "Dark mode"}</span>}
          </button>

          {collapsed && showCollapseToggle ? (
            <button
              onClick={() => setCollapsed(false)}
              className="w-full flex justify-center rounded-md py-2 text-muted-foreground hover:bg-sidebar-accent"
              aria-label="Expand sidebar"
            >
              <ChevronLeft className="h-4 w-4 rotate-180" />
            </button>
          ) : !collapsed ? (
            <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <Avatar name={user?.username ?? user?.email ?? "?"} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{user?.username ?? "—"}</p>
                <p className="text-[11px] text-muted-foreground truncate capitalize">{user?.role ?? "—"}</p>
              </div>
              <button
                onClick={handleLogout}
                className="p-1 rounded text-muted-foreground hover:text-destructive"
                aria-label="Logout"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>
      </aside>
    </TooltipProvider>
  );
}
