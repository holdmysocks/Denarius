import { useEffect, useState, useRef } from "react";
import { Moon, Sun, Globe, Download, Upload, UserPlus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useThemeStore } from "@/store/themeStore";
import { useSettingsStore } from "@/store/settingsStore";
import {
  usePreferencesStore,
  type AccentColor,
  type Density,
  type SidebarStyle,
} from "@/store/preferencesStore";
import { TIMEZONES } from "@/lib/timezones";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useAccounts } from "@/api/accounts";
import { useDashboardStore } from "@/store/dashboardStore";
import { useAuthStore } from "@/store/authStore";
import { cn } from "@/lib/utils";
import { exportData, importData, type ImportResult } from "@/api/export";
import {
  useCreateUser,
  useDeleteUserPermanently,
  useUpdateUser,
  useUsers,
  type UserOut,
  type UserRole,
  type UserUpdate,
} from "@/api/users";

interface Account {
  id: string;
  name: string;
  type: string;
  current_balance: number;
  is_active: boolean;
  institution?: string | null;
  notes?: string | null;
  color?: string;
  linked_mortgage_id?: string | null;
}

// ---- Shared Spinner ----
function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

function parseApiError(err: unknown, fallback: string): string {
  const axiosErr = err as {
    response?: { data?: { detail?: string | Array<{ loc?: (string | number)[]; msg?: string }> } };
  };
  const detail = axiosErr?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => {
        const field = d.loc?.[d.loc.length - 1];
        const msg = (d.msg ?? "").replace(/^Value error,\s*/i, "");
        return field ? `${field}: ${msg}` : msg;
      })
      .filter(Boolean);
    if (msgs.length) return msgs.join(" · ");
  }
  return fallback;
}

interface UserDialogProps {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user?: UserOut;
}

function UserDialog({ mode, open, onOpenChange, user }: UserDialogProps) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const createUser = useCreateUser();
  const updateUser = useUpdateUser(user?.id ?? "");
  const deleteUser = useDeleteUserPermanently();
  const currentUser = useAuthStore((s) => s.user);
  const isEditingSelf = mode === "edit" && user?.id === currentUser?.id;

  useEffect(() => {
    if (open) {
      const timeout = window.setTimeout(() => {
        setUsername(user?.username ?? "");
        setEmail(user?.email ?? "");
        setPassword("");
        setConfirmPassword("");
        setRole(user?.role ?? "member");
        setError(null);
        setConfirmingDelete(false);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
  }, [open, user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "create") {
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      try {
        await createUser.mutateAsync({ username, email, password, role });
        onOpenChange(false);
      } catch (err) {
        setError(parseApiError(err, "Failed to create user."));
      }
      return;
    }

    // edit mode
    const payload: UserUpdate = {};
    if (username && username !== user?.username) payload.username = username;
    if (email && email !== user?.email) payload.email = email;
    if (password) {
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      payload.password = password;
    }
    if (Object.keys(payload).length === 0) {
      onOpenChange(false);
      return;
    }
    try {
      await updateUser.mutateAsync(payload);
      onOpenChange(false);
    } catch (err) {
      setError(parseApiError(err, "Failed to update user."));
    }
  }

  async function handlePermanentDelete() {
    if (!user) return;
    setError(null);
    try {
      await deleteUser.mutateAsync(user.id);
      onOpenChange(false);
    } catch (err) {
      setError(parseApiError(err, "Failed to delete user."));
      setConfirmingDelete(false);
    }
  }

  const pending = createUser.isPending || updateUser.isPending || deleteUser.isPending;

  if (mode === "edit" && confirmingDelete && user) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete {user.username} permanently?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              This removes <strong>{user.username}</strong> ({user.email}) from the system.
              This action cannot be undone.
            </p>
            <p className="text-muted-foreground">
              Any transactions or recurring items they created will be reassigned to you
              ({currentUser?.username}) so nothing is lost.
            </p>
            {error && (
              <p className="text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingDelete(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handlePermanentDelete} disabled={pending}>
              {deleteUser.isPending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add user" : `Edit ${user?.username ?? "user"}`}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="user-username">Username</Label>
            <Input
              id="user-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-email">Email</Label>
            <Input
              id="user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-password">
              {mode === "edit" ? "New password (leave blank to keep current)" : "Password"}
            </Label>
            <Input
              id="user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required={mode === "create"}
              minLength={mode === "create" ? 8 : undefined}
              placeholder={mode === "edit" ? "••••••••" : undefined}
            />
          </div>
          {(mode === "create" || password.length > 0) && (
            <div className="space-y-1.5">
              <Label htmlFor="user-password-confirm">Confirm password</Label>
              <Input
                id="user-password-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          )}
          {mode === "create" && (
            <div className="space-y-1.5">
              <Label htmlFor="user-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger id="user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          <DialogFooter className="pt-2 sm:justify-between sm:items-center">
            {mode === "edit" && !isEditingSelf ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmingDelete(true)}
                disabled={pending}
                className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
              >
                <Trash2 className="h-4 w-4" />
                Delete permanently
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : mode === "create" ? "Create user" : "Save changes"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UsersTab() {
  const { data: users = [], isLoading, isError } = useUsers();
  const userList = users;
  const currentUser = useAuthStore((s) => s.user);
  const [createOpen, setCreateOpen] = useState(false);

  if (isLoading) return <Spinner />;
  if (isError) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-4 py-3">
        Failed to load users.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{userList.length} users</p>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-2">
          <UserPlus className="h-4 w-4" />
          Add user
        </Button>
      </div>
      <UserDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />
      {userList.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">No users found.</div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Username</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {userList.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    isCurrentUser={user.id === currentUser?.id}
                  />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function UserRow({ user, isCurrentUser }: { user: UserOut; isCurrentUser: boolean }) {
  const updateUser = useUpdateUser(user.id);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  async function handleRoleChange(newRole: UserRole) {
    setRoleError(null);
    try {
      await updateUser.mutateAsync({ role: newRole });
    } catch {
      setRoleError("Failed to update role.");
    }
  }

  async function handleToggleActive() {
    try {
      await updateUser.mutateAsync({ is_active: !user.is_active });
    } catch {
      // silently fail
    }
  }

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3 font-medium">
        {user.username}
        {isCurrentUser && (
          <Badge variant="outline" className="ml-2 text-xs">You</Badge>
        )}
      </td>
      <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
      <td className="px-4 py-3">
        {isCurrentUser ? (
          <Badge variant="outline" className="capitalize">{user.role}</Badge>
        ) : (
          <div className="flex items-center gap-2">
            <Select
              value={user.role}
              onValueChange={handleRoleChange}
              disabled={updateUser.isPending}
            >
              <SelectTrigger className="w-28 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
              </SelectContent>
            </Select>
            {roleError && <span className="text-xs text-destructive">{roleError}</span>}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge
          variant="outline"
          className={cn(
            "text-xs",
            user.is_active ? "border-emerald-500 text-emerald-600" : "border-muted-foreground text-muted-foreground"
          )}
        >
          {user.is_active ? "Active" : "Inactive"}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7 gap-1"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="h-3 w-3" />
            Edit
          </Button>
          {!isCurrentUser && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={handleToggleActive}
              disabled={updateUser.isPending}
            >
              {user.is_active ? "Deactivate" : "Activate"}
            </Button>
          )}
        </div>
        <UserDialog mode="edit" user={user} open={editOpen} onOpenChange={setEditOpen} />
      </td>
    </tr>
  );
}

// ---- Personalization (Appearance) ----
const ACCENTS: { value: AccentColor; label: string; swatch: string }[] = [
  { value: "gold", label: "Gold", swatch: "#C9A84C" },
  { value: "rose", label: "Rose", swatch: "#E11D48" },
  { value: "sky", label: "Sky", swatch: "#0284C7" },
  { value: "emerald", label: "Emerald", swatch: "#059669" },
  { value: "violet", label: "Violet", swatch: "#7C3AED" },
];

const DENSITIES: { value: Density; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
  { value: "spacious", label: "Spacious" },
];

const SIDEBAR_STYLES: { value: SidebarStyle; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "minimal", label: "Minimal" },
  { value: "floating", label: "Floating" },
];

function PersonalizationCard() {
  const accentColor = usePreferencesStore((s) => s.accentColor);
  const setAccent = usePreferencesStore((s) => s.setAccent);
  const density = usePreferencesStore((s) => s.density);
  const setDensity = usePreferencesStore((s) => s.setDensity);
  const sidebarStyle = usePreferencesStore((s) => s.sidebarStyle);
  const setSidebarStyle = usePreferencesStore((s) => s.setSidebarStyle);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Personalization
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="text-sm font-medium mb-2">Accent color</p>
          <div className="flex items-center gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a.value}
                onClick={() => setAccent(a.value)}
                aria-label={a.label}
                title={a.label}
                className={cn(
                  "h-8 w-8 rounded-full border-2 transition-transform",
                  accentColor === a.value ? "border-foreground scale-110" : "border-transparent",
                )}
                style={{ background: a.swatch }}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Density</p>
          <div className="inline-flex rounded-md border bg-background p-0.5">
            {DENSITIES.map((d) => (
              <button
                key={d.value}
                onClick={() => setDensity(d.value)}
                className={cn(
                  "px-3 py-1.5 text-xs rounded-sm transition-colors",
                  density === d.value
                    ? "bg-[var(--ea-accent)] text-[var(--ea-accent-contrast)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Sidebar style</p>
          <div className="inline-flex rounded-md border bg-background p-0.5">
            {SIDEBAR_STYLES.map((s) => (
              <button
                key={s.value}
                onClick={() => setSidebarStyle(s.value)}
                className={cn(
                  "px-3 py-1.5 text-xs rounded-sm transition-colors",
                  sidebarStyle === s.value
                    ? "bg-[var(--ea-accent)] text-[var(--ea-accent-contrast)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Preferences Tab ----
function PreferencesTab() {
  const { isDark, toggle } = useThemeStore();
  const { timezone, setTimezone } = useSettingsStore();
  const { hiddenAccountIds, toggleAccount } = useDashboardStore();
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const accountList: Account[] = Array.isArray(accounts) ? accounts : [];
  const currentUser = useAuthStore.getState().user;
  const isAdmin = currentUser?.role === "admin";

  const [tzSearch, setTzSearch] = useState("");
  const filteredTzs = tzSearch.trim()
    ? TIMEZONES.filter((tz) =>
        tz.label.toLowerCase().includes(tzSearch.toLowerCase()) ||
        tz.value.toLowerCase().includes(tzSearch.toLowerCase())
      )
    : TIMEZONES;
  const currentTzLabel = TIMEZONES.find((t) => t.value === timezone)?.label ?? timezone;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Appearance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isDark ? <Moon className="h-4 w-4 text-muted-foreground" /> : <Sun className="h-4 w-4 text-muted-foreground" />}
              <div>
                <p className="text-sm font-medium">Dark Mode</p>
                <p className="text-xs text-muted-foreground">
                  {isDark ? "Dark theme is active" : "Light theme is active"}
                </p>
              </div>
            </div>
            <Switch checked={isDark} onCheckedChange={toggle} />
          </div>
        </CardContent>
      </Card>

      <PersonalizationCard />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Date &amp; Time
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3">
            <Globe className="h-4 w-4 text-muted-foreground mt-2.5 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <p className="text-sm font-medium">Timezone</p>
              <p className="text-xs text-muted-foreground">
                Controls which day "today" falls on and how dates default throughout the app.
                {!isAdmin && " Only admins can change this."}
              </p>
              <Select value={timezone} onValueChange={setTimezone} disabled={!isAdmin}>
                <SelectTrigger className="w-full">
                  <SelectValue>{currentTzLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <div className="px-2 pb-1 pt-1">
                    <input
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                      placeholder="Search timezones…"
                      value={tzSearch}
                      onChange={(e) => setTzSearch(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                  {filteredTzs.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No results.</div>
                  ) : (
                    filteredTzs.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Dashboard Balance Chart
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Choose which accounts appear in the balance history chart on the dashboard.
          </p>
          {accountsLoading ? (
            <div className="py-4 flex items-center justify-center">
              <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          ) : accountList.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts found.</p>
          ) : (
            <div className="space-y-2">
              {accountList.map((account) => {
                const isVisible = !hiddenAccountIds.includes(account.id);
                return (
                  <div key={account.id} className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-sm font-medium">{account.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{account.type}</p>
                    </div>
                    <Switch
                      checked={isVisible}
                      onCheckedChange={() => toggleAccount(account.id)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Data Tab ----
const APP_VERSION = "1.1.0";

const EXPORT_ITEMS = [
  { key: "include_categories", label: "Categories" },
  { key: "include_accounts", label: "Accounts" },
  { key: "include_expense_accounts", label: "Expense Accounts" },
  { key: "include_recurring", label: "Bills & Recurring Items" },
  { key: "include_budgets", label: "Budgets" },
  { key: "include_settings", label: "Application Settings" },
  { key: "include_mortgage", label: "Mortgage Details" },
  { key: "include_networth", label: "Net Worth Snapshots" },
  { key: "include_transactions", label: "Transactions" },
] as const;

type ExportKey = (typeof EXPORT_ITEMS)[number]["key"];

function DataTab() {
  const [selected, setSelected] = useState<Set<ExportKey>>(
    new Set(EXPORT_ITEMS.map((i) => i.key))
  );
  const [txStartDate, setTxStartDate] = useState("");
  const [txEndDate, setTxEndDate] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function toggleKey(key: ExportKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleExport() {
    if (selected.size === 0) {
      setExportError("Select at least one item to export.");
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      const params: Record<string, string | boolean> = {};
      for (const key of selected) params[key] = true;
      if (selected.has("include_transactions")) {
        if (txStartDate) params["transaction_start_date"] = txStartDate;
        if (txEndDate) params["transaction_end_date"] = txEndDate;
      }
      await exportData(params);
    } catch {
      setExportError("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  async function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setImportError("Please select a JSON file to import.");
      return;
    }
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const result = await importData(file);
      setImportResult(result);
    } catch (err) {
      setImportError(parseApiError(err, "Import failed. Make sure the file is a valid Denarius export."));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const showDateRange = selected.has("include_transactions");

  return (
    <div className="space-y-4">
      {/* Export */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export Data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Download a JSON backup of your selected data. All selected sections are combined into one file.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {EXPORT_ITEMS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => toggleKey(key)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>

          {showDateRange && (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Transaction date range (optional)</p>
              <p className="text-xs text-muted-foreground">
                Filtered transaction exports are archival and cannot be restored because they do not contain a complete account ledger.
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-10">From</label>
                  <input
                    type="date"
                    value={txStartDate}
                    onChange={(e) => setTxStartDate(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-10">To</label>
                  <input
                    type="date"
                    value={txEndDate}
                    onChange={(e) => setTxEndDate(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {exportError && (
            <p className="text-xs text-destructive">{exportError}</p>
          )}

          <Button onClick={handleExport} disabled={exporting} size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            {exporting ? "Exporting…" : "Export JSON"}
          </Button>
        </CardContent>
      </Card>

      {/* Import */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Import Data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Restore from a previously exported Denarius JSON file. Matching financial records are skipped; exported application and user preferences are restored.
          </p>

          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1 file:text-xs file:font-medium cursor-pointer"
            />
            <Button onClick={handleImport} disabled={importing} size="sm" variant="outline" className="gap-2">
              <Upload className="h-4 w-4" />
              {importing ? "Importing…" : "Import"}
            </Button>
          </div>

          {importError && (
            <p className="text-xs text-destructive">{importError}</p>
          )}

          {importResult && (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2 text-xs">
              {importResult.errors.length > 0 && (
                <div>
                  <p className="font-medium text-destructive mb-1">Errors ({importResult.errors.length})</p>
                  <ul className="space-y-0.5 text-destructive/80">
                    {importResult.errors.slice(0, 10).map((e, i) => (
                      <li key={i} className="truncate">• {e}</li>
                    ))}
                    {importResult.errors.length > 10 && (
                      <li className="text-muted-foreground">…and {importResult.errors.length - 10} more</li>
                    )}
                  </ul>
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {Object.keys({ ...importResult.imported, ...importResult.skipped }).map((section) => (
                  <div key={section} className="flex justify-between gap-2">
                    <span className="text-muted-foreground capitalize">{section.replace(/_/g, " ")}</span>
                    <span>
                      <span className="text-emerald-600 font-medium">{importResult.imported[section] ?? 0} imported</span>
                      {(importResult.skipped[section] ?? 0) > 0 && (
                        <span className="text-muted-foreground ml-2">{importResult.skipped[section]} skipped</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            About
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono">{APP_VERSION}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Source</span>
            <a
              href="https://github.com/holdmysocks/Denarius"
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary hover:underline"
            >
              github.com/holdmysocks/Denarius
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Main Settings Page ----
export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">Manage preferences and users.</p>
      </div>

      {isAdmin ? (
        <Tabs defaultValue="preferences">
          <TabsList>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
          </TabsList>

          <TabsContent value="preferences" className="mt-6">
            <PreferencesTab />
          </TabsContent>

          <TabsContent value="users" className="mt-6">
            <UsersTab />
          </TabsContent>

          <TabsContent value="data" className="mt-6">
            <DataTab />
          </TabsContent>
        </Tabs>
      ) : (
        <PreferencesTab />
      )}
    </div>
  );
}
