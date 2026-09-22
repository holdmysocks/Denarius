import { useState } from "react";
import { Check, Copy, Download, KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccounts, type AccountOut, type AccountType } from "@/api/accounts";
import { useCategories } from "@/api/categories";
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useSetShortcutLink,
  useShortcutSettings,
  useUpdateShortcutSettings,
  type ShortcutConfirmation,
  type ShortcutKind,
  type ShortcutOptions,
  type ShortcutSettings,
  type ShortcutSettingsOut,
} from "@/api/shortcuts";
import { useAuthStore } from "@/store/authStore";
import { cn, formatDate } from "@/lib/utils";

// Mirrors SHORTCUT_ACCOUNT_TYPES in backend/app/services/shortcut_service.py.
const SHORTCUT_ACCOUNT_TYPES: AccountType[] = ["checking", "savings", "credit_card", "cash", "other"];
const NONE = "__none__";

/** iPhone, iPad (which reports itself as a Mac) and Mac all run Shortcuts. */
export function isAppleDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
}

/** Copy text, falling back to a hidden textarea when the Clipboard API is
 *  unavailable (it requires HTTPS, and test servers are often plain HTTP). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  el.setSelectionRange(0, text.length);
  const ok = document.execCommand("copy");
  document.body.removeChild(el);
  return ok;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={async () => {
            if (await copyText(value)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
      {children}
    </CardTitle>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border bg-background p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "px-3 py-1.5 text-xs rounded-sm transition-colors",
            value === o.value
              ? "bg-[var(--ea-accent)] text-[var(--ea-accent-contrast)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={(v) => onChange?.(v)} disabled={disabled} />
    </div>
  );
}

// ---- Get the shortcuts ----

const SHORTCUTS: { kind: ShortcutKind; name: string; phrase: string }[] = [
  { kind: "expense", name: "Add Expense", phrase: "Hey Siri, add expense" },
  { kind: "income", name: "Add Income", phrase: "Hey Siri, add income" },
];

function ShortcutLinkInput({ kind, current }: { kind: ShortcutKind; current: string | null }) {
  const setLink = useSetShortcutLink();
  const [draft, setDraft] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder="https://www.icloud.com/shortcuts/…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={setLink.isPending || draft.trim() === (current ?? "")}
          onClick={() => {
            setError(null);
            setLink.mutate(
              { kind, shortcut_url: draft.trim() || null },
              { onError: () => setError("That doesn't look like an iCloud shortcut link.") },
            );
          }}
        >
          Save
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function InstallCard({ settings }: { settings: ShortcutSettingsOut }) {
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");
  const links: Record<ShortcutKind, string | null> = {
    expense: settings.expense_shortcut_url,
    income: settings.income_shortcut_url,
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionTitle>Get the shortcuts</SectionTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Each shortcut reads its settings below every time it runs, so changes here apply straight away without
          reinstalling.
        </p>

        <div className="divide-y rounded-md border">
          {SHORTCUTS.map((s) => (
            <div key={s.kind} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">"{s.phrase}"</p>
                </div>
                {links[s.kind] ? (
                  <Button asChild size="sm">
                    <a href={links[s.kind] ?? undefined} target="_blank" rel="noreferrer">
                      <Download className="h-4 w-4" />
                      Import
                    </a>
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {isAdmin ? "Add its iCloud link below" : "Not shared yet"}
                  </p>
                )}
              </div>
              {isAdmin && <ShortcutLinkInput kind={s.kind} current={links[s.kind]} />}
            </div>
          ))}
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">
            After importing, open each shortcut and replace <span className="font-mono">ADDRESS-HERE</span> (in the
            first two text boxes) with your Denarius address, and <span className="font-mono">KEY-HERE</span> with your
            API key.
          </p>
          <CopyField label="Denarius address" value={window.location.origin} />
          <p className="text-xs text-muted-foreground">Create an API key below. One key works for both shortcuts.</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- API keys ----

function ApiKeysCard() {
  const { data: apiKeys = [] } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const [name, setName] = useState("iPhone");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionTitle>API keys</SectionTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The shortcut uses a key instead of your password. A key can only add transactions and read your
          account and category names. It can't see balances or change anything else.
        </p>

        {newKey ? (
          <div className="space-y-2 rounded-md border border-[var(--ea-accent)] p-3">
            <CopyField label="Your new API key" value={newKey} />
            <p className="text-xs text-muted-foreground">
              Copy it now and paste it into the shortcut. It won't be shown again.
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setNewKey(null)}>
              Done
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Device name" maxLength={100} />
            <Button
              type="button"
              className="shrink-0"
              disabled={!name.trim() || createKey.isPending}
              onClick={() => createKey.mutate(name.trim(), { onSuccess: (k) => setNewKey(k.key) })}
            >
              <KeyRound className="h-4 w-4" />
              Create key
            </Button>
          </div>
        )}

        {apiKeys.length > 0 && (
          <div className="divide-y rounded-md border">
            {apiKeys.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{k.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{k.key_prefix}…</span> · created {formatDate(k.created_at.slice(0, 10))}
                    {" · "}
                    {k.last_used_at ? `last used ${formatDate(k.last_used_at.slice(0, 10))}` : "never used"}
                  </p>
                </div>
                {confirmRevoke === k.id ? (
                  <div className="flex gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={revokeKey.isPending}
                      onClick={() => revokeKey.mutate(k.id, { onSettled: () => setConfirmRevoke(null) })}
                    >
                      Revoke
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRevoke(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Revoke ${k.name}`}
                    onClick={() => setConfirmRevoke(k.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Behaviour ----

function ShortcutCard({
  kind,
  settings,
  onSave,
}: {
  kind: ShortcutKind;
  settings: ShortcutSettings;
  onSave: (next: ShortcutSettings) => void;
}) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories(kind);
  const options = settings[kind];
  const meta = SHORTCUTS.find((s) => s.kind === kind)!;

  const accountOptions = (accounts as AccountOut[]).filter(
    (a) => a.is_active && SHORTCUT_ACCOUNT_TYPES.includes(a.type),
  );

  function save(patch: Partial<ShortcutOptions>) {
    onSave({ ...settings, [kind]: { ...options, ...patch } });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionTitle>{meta.name}</SectionTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">What Siri asks</p>
          <ToggleRow title="Amount" description="Always asked." checked disabled />
          <ToggleRow
            title="Description"
            description={kind === "expense" ? '"What for?" For example, lunch or gas.' : '"What for?" For example, paycheck.'}
            checked={options.ask_description}
            onChange={(v) => save({ ask_description: v })}
          />
          <ToggleRow
            title="Category"
            description={'Pick from your categories, or choose "Auto".'}
            checked={options.ask_category}
            onChange={(v) => save({ ask_category: v })}
          />
          <ToggleRow
            title="Account"
            description="Otherwise uses the default account below."
            checked={options.ask_account}
            onChange={(v) => save({ ask_account: v })}
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Default account</p>
          <p className="text-xs text-muted-foreground">
            Where {kind === "expense" ? "expenses" : "income"} go when Siri doesn't ask.
            {accountOptions.length > 1 && !options.default_account_id && " Required unless Siri asks for the account."}
          </p>
          <Select
            value={options.default_account_id ?? NONE}
            onValueChange={(v) => save({ default_account_id: v === NONE ? null : v })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose an account" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No default</SelectItem>
              {accountOptions.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Default category</p>
          <p className="text-xs text-muted-foreground">Used when no category is picked or guessed.</p>
          <Select
            value={options.default_category_id ?? NONE}
            onValueChange={(v) => save({ default_category_id: v === NONE ? null : v })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="No category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No category</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

function BehaviourCards({ settings }: { settings: ShortcutSettings }) {
  const update = useUpdateShortcutSettings();
  const [error, setError] = useState<string | null>(null);

  function save(next: ShortcutSettings) {
    setError(null);
    update.mutate(
      { expense: next.expense, income: next.income, auto_category: next.auto_category, confirmation: next.confirmation },
      { onError: () => setError("Couldn't save that change. Please try again.") },
    );
  }

  return (
    <>
      <ShortcutCard kind="expense" settings={settings} onSave={save} />
      <ShortcutCard kind="income" settings={settings} onSave={save} />

      <Card>
        <CardHeader className="pb-3">
          <SectionTitle>Both shortcuts</SectionTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <ToggleRow
            title="Guess the category"
            description="Reuses the category from your last transaction with the same description, or a category named in it."
            checked={settings.auto_category}
            onChange={(v) => save({ ...settings, auto_category: v })}
          />
          <div className="space-y-2">
            <p className="text-sm font-medium">After adding</p>
            <Segmented<ShortcutConfirmation>
              value={settings.confirmation}
              options={[
                { value: "notify", label: "Show it" },
                { value: "speak", label: "Say it" },
                { value: "none", label: "Nothing" },
              ]}
              onChange={(v) => save({ ...settings, confirmation: v })}
            />
            <p className="text-xs text-muted-foreground">Errors are always shown.</p>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </>
  );
}

export default function ShortcutsTab() {
  const { data: settings, isLoading } = useShortcutSettings();

  if (isLoading || !settings) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <InstallCard settings={settings} />
      <ApiKeysCard />
      <BehaviourCards settings={settings} />
    </div>
  );
}
