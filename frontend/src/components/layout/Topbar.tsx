import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, Search, LogOut, User } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import { logout } from "@/api/auth";
import { useNotifications } from "@/api/notifications";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/accounts": "Asset Accounts",
  "/expense-accounts": "Expense Accounts",
  "/categories": "Categories",
  "/transactions": "Transactions",
  "/budgets": "Budgets",
  "/recurring": "Recurring & Subscriptions",
  "/mortgage": "Mortgage",
  "/loans": "Loans",
  "/networth": "Net Worth",
  "/reports": "Reports",
  "/settings": "Settings",
};

interface TopbarProps {
  onOpenSearch: () => void;
  onMobileMenuOpen?: () => void;
}

function formatClock(now: Date, tz: string) {
  return {
    time: new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(now),
    date: new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(now),
  };
}

function useClock(tz: string) {
  const [clock, setClock] = useState(() => formatClock(new Date(), tz));
  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date(), tz)), 30_000);
    return () => clearInterval(id);
  }, [tz]);
  return clock;
}

export function Topbar({ onOpenSearch }: TopbarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const timezone = useSettingsStore((s) => s.timezone);
  const clock = useClock(timezone);
  const { items: notifications, count: notifCount } = useNotifications();

  const title =
    TITLES[location.pathname] ??
    Object.entries(TITLES).find(([k]) => k !== "/" && location.pathname.startsWith(k))?.[1] ??
    "Denarius";

  const keyHint =
    typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘K" : "Ctrl K";

  const handleLogout = async () => {
    await logout();
  };

  return (
    <header className="sticky top-0 z-20 h-14 bg-background/80 backdrop-blur border-b">
      <div className="h-full px-4 md:px-6 flex items-center gap-3">
        <h1 className="text-sm md:text-base font-semibold tracking-tight truncate flex-1">
          {title}
        </h1>

        <button
          onClick={onOpenSearch}
          className={cn(
            "hidden sm:flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground hover:border-[var(--ea-accent)] transition-colors min-w-[240px]",
          )}
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="text-[10px] tracking-wider rounded border px-1 py-0.5">
            {keyHint}
          </kbd>
        </button>

        <button
          onClick={onOpenSearch}
          className="sm:hidden p-2 text-muted-foreground rounded-md hover:bg-muted"
          aria-label="Search"
        >
          <Search className="h-4 w-4" />
        </button>

        <Popover>
          <PopoverTrigger asChild>
            <button
              className="relative p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
              {notifCount > 0 && (
                <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-b flex items-center justify-between">
              <span>Notifications</span>
              {notifCount > 0 && <span className="text-foreground">{notifCount}</span>}
            </div>
            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No new notifications
              </div>
            ) : (
              <ul className="max-h-80 overflow-y-auto py-1">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => navigate(n.link)}
                      className="w-full text-left px-3 py-2 hover:bg-muted flex items-start gap-2"
                    >
                      <span
                        className={cn(
                          "mt-1.5 h-2 w-2 rounded-full shrink-0",
                          n.severity === "danger" && "bg-destructive",
                          n.severity === "warning" && "bg-warning",
                          n.severity === "info" && "bg-info",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{n.title}</span>
                        {n.subtitle && (
                          <span className="block truncate text-xs text-muted-foreground">{n.subtitle}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PopoverContent>
        </Popover>

        <div className="hidden sm:block text-right">
          <div className="text-xs font-medium tabular-nums leading-tight">{clock.time}</div>
          <div className="text-[10px] text-muted-foreground leading-tight">{clock.date}</div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full p-0 h-9 w-9"
              aria-label="Account menu"
            >
              <Avatar name={user?.username ?? user?.email ?? "?"} size="sm" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <div className="text-xs text-muted-foreground capitalize">{user?.role}</div>
              {user?.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="/settings" className="flex items-center gap-2 cursor-pointer">
                <User className="h-4 w-4" /> Profile & Settings
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
