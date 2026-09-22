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
  type ShortcutSettings,
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

// ---- Get the shortcut ----

function InstallCard({ shortcutUrl }: { shortcutUrl: string | null }) {
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");
  const setLink = useSetShortcutLink();
  const [draft, setDraft] = useState(shortcutUrl ?? "");
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionTitle>Get the shortcut</SectionTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Add the <span className="font-medium text-foreground">Add Transaction</span> shortcut, then say
          <span className="font-medium text-foreground"> "Hey Siri, add transaction"</span>. It reads the
          settings below every time it runs, so changes here apply straight away without reinstalling.
        </p>

        {shortcutUrl ? (
          <Button asChild>
            <a href={shortcutUrl} target="_blank" rel="noreferrer">
              <Download className="h-4 w-4" />
              Import shortcut
            </a>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Paste the shortcut's iCloud link below to enable the Import button."
              : "An admin hasn't added the shortcut link yet."}
          </p>
        )}

        <div className="space-y-3 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">
            After importing, open the shortcut and paste these into the first two text boxes.
          </p>
          <CopyField label="Denarius address" value={window.location.origin} />
          <p className="text-xs text-muted-foreground">
            Your API key goes in the second box. Create one under API keys below.
          </p>
        </div>

        {isAdmin && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Shortcut iCloud link (admin)</p>
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
                disabled={setLink.isPending || draft.trim() === (shortcutUrl ?? "")}
                onClick={() => {
                  setError(null);
                  setLink.mutate(draft.trim() || null, {
                    onError: () => setError("That doesn't look like an iCloud shortcut link."),
                  });
                }}
              >
                Save
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}
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

function BehaviourCards({ settings }: { settings: ShortcutSettings }) {
  const update = useUpdateShortcutSettings();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories(settings.default_type);
  const [error, setError] = useState<string | null>(null);

  const accountOptions = (accounts as AccountOut[]).filter(
    (a) => a.is_active && SHORTCUT_ACCOUNT_TYPES.includes(a.type),
  );

  function save(patch: Partial<ShortcutSettings>) {
    const next = { ...settings, ...patch };
    // A default category only makes sense for the matching transaction type.
    if (patch.default_type && patch.default_type !== settings.default_type) {
      next.default_category_id = null;
    }
    setError(null);
    update.mutate(next, { onError: () => setError("Couldn't save that change. Please try again.") });
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <SectionTitle>What Siri asks</SectionTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <ToggleRow title="Amount" description="Always asked." checked disabled />
          <ToggleRow
            title="Description"
            description={'"What for?" For example, lunch or gas.'}
            checked={settings.ask_description}
            onChange={(v) => save({ ask_description: v })}
          />
          <ToggleRow
            title="Expense or income"
            description="Otherwise uses the default type below."
            checked={settings.ask_type}
            onChange={(v) => save({ ask_type: v })}
          />
          <ToggleRow
            title="Category"
            description='Pick from your categories, or choose "Auto".'
            checked={settings.ask_category}
            onChange={(v) => save({ ask_category: v })}
          />
          <ToggleRow
            title="Account"
            description="Otherwise uses the default account below."
            checked={settings.ask_account}
            onChange={(v) => save({ ask_account: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <SectionTitle>Defaults</SectionTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <p className="text-sm font-medium mb-2">Type</p>
            <Segmented
              value={settings.default_type}
              options={[
                { value: "expense", label: "Expense" },
                { value: "income", label: "Income" },
              ]}
              onChange={(v) => save({ default_type: v })}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Account</p>
            <p className="text-xs text-muted-foreground">
              Where transactions go when Siri doesn't ask.
              {accountOptions.length > 1 && !settings.default_account_id && " Required unless Siri asks for the account."}
            </p>
            <Select
              value={settings.default_account_id ?? NONE}
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
            <p className="text-sm font-medium">Category</p>
            <p className="text-xs text-muted-foreground">Used when no category is picked or guessed.</p>
            <Select
              value={settings.default_category_id ?? NONE}
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

          <ToggleRow
            title="Guess the category"
            description="Reuses the category from your last transaction with the same description, or a category named in it."
            checked={settings.auto_category}
            onChange={(v) => save({ auto_category: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <SectionTitle>After adding</SectionTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Segmented<ShortcutConfirmation>
            value={settings.confirmation}
            options={[
              { value: "notify", label: "Show it" },
              { value: "speak", label: "Say it" },
              { value: "none", label: "Nothing" },
            ]}
            onChange={(v) => save({ confirmation: v })}
          />
          <p className="text-xs text-muted-foreground">Errors are always shown.</p>
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
      <InstallCard shortcutUrl={settings.shortcut_url} />
      <ApiKeysCard />
      <BehaviourCards settings={settings} />
    </div>
  );
}
