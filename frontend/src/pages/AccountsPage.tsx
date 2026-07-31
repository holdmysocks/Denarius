import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  createAccountWithMortgage,
  useAccounts,
  useDeleteAccount,
  updateAccountWithMortgage,
  type AccountCreateInput,
  type AccountOut,
  type AccountType,
} from "@/api/accounts";
import { getMortgage, type MortgageCreateInput } from "@/api/mortgage";
import { cn } from "@/lib/utils";
import { TransactionListDialog } from "@/components/TransactionListDialog";

interface AccountFormState {
  name: string;
  type: AccountType;
  balance: string;
  institution: string;
  account_number: string;
  notes: string;
  color: string;
  // Mortgage/Loan fields
  original_principal: string;
  interest_rate: string;
  term_months: string;
  origination_date: string;
  extra_payment: string;
  loan_type: string;
  // Property → mortgage link
  link_mortgage: boolean;
  mortgage_link_mode: "existing" | "new";
  linked_mortgage_id: string;
  new_mortgage_name: string;
}

const emptyAccountForm = (): AccountFormState => ({
  name: "",
  type: "checking",
  balance: "0",
  institution: "",
  account_number: "",
  notes: "",
  color: "#6B7280",
  original_principal: "",
  interest_rate: "",
  term_months: "",
  origination_date: "",
  extra_payment: "",
  loan_type: "",
  link_mortgage: false,
  mortgage_link_mode: "existing",
  linked_mortgage_id: "",
  new_mortgage_name: "",
});

const LOAN_TYPES = [
  { value: "auto", label: "Auto" },
  { value: "student", label: "Student" },
  { value: "personal", label: "Personal" },
  { value: "business", label: "Business" },
  { value: "home_equity", label: "Home Equity" },
  { value: "other", label: "Other" },
];

const MORTGAGE_TYPES = ["mortgage", "loan"];
const LIABILITY_TYPES = ["credit_card", "loan", "mortgage"];
const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "credit_card",
  "investment",
  "mortgage",
  "loan",
  "property",
  "cash",
  "other",
];

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

export default function AccountsPage() {
  const queryClient = useQueryClient();
  const { data: accounts = [], isLoading, isError } = useAccounts();

  const [addOpen, setAddOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<AccountOut | null>(null);
  const [form, setForm] = useState<AccountFormState>(emptyAccountForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [txDialog, setTxDialog] = useState<{ id: string; name: string } | null>(null);

  const accountList = accounts;
  const mortgageAccounts = accountList.filter((a) => a.type === "mortgage");

  // Auto-open the Transactions dialog when arriving from the global search
  // (/accounts?open=<id>). Fires once per navigation.
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get("open");
  const consumedOpen = useRef(false);
  useEffect(() => {
    if (!openId) {
      consumedOpen.current = false;
      return;
    }
    if (consumedOpen.current || !openId || accountList.length === 0) return;
    const acc = accountList.find((a) => a.id === openId);
    if (acc) {
      consumedOpen.current = true;
      const timeout = window.setTimeout(() => {
        setTxDialog({ id: acc.id, name: acc.name });
        const next = new URLSearchParams(searchParams);
        next.delete("open");
        setSearchParams(next, { replace: true });
      }, 0);
      return () => window.clearTimeout(timeout);
    }
  }, [openId, accountList, searchParams, setSearchParams]);
  const isMortgage = MORTGAGE_TYPES.includes(form.type);

  function openAdd() {
    setEditAccount(null);
    setForm(emptyAccountForm());
    setFormError(null);
    setAddOpen(true);
  }

  async function openEdit(account: AccountOut) {
    setEditAccount(account);
    setForm({
      name: account.name,
      type: account.type,
      balance: LIABILITY_TYPES.includes(account.type)
        ? String(Math.abs(Number(account.current_balance)))
        : String(account.current_balance),
      institution: account.institution ?? "",
      account_number: account.account_number ?? "",
      notes: account.notes ?? "",
      color: account.color ?? "#6B7280",
      original_principal: "",
      interest_rate: "",
      term_months: "",
      origination_date: "",
      extra_payment: "",
      loan_type: "",
      link_mortgage: !!account.linked_mortgage_id,
      mortgage_link_mode: "existing",
      linked_mortgage_id: account.linked_mortgage_id ?? "",
      new_mortgage_name: "",
    });
    setFormError(null);
    setAddOpen(true);
    if (MORTGAGE_TYPES.includes(account.type)) {
      try {
        const data = await getMortgage(account.id);
        setForm((prev) => ({
          ...prev,
          original_principal: String(data.original_principal),
          interest_rate: String(data.interest_rate),
          term_months: String(data.term_months),
          origination_date: data.start_date,
          extra_payment: String(data.extra_payment),
          loan_type: data.loan_type ?? "",
        }));
      } catch {
        // no mortgage details yet — leave fields empty
      }
    }
  }

  const deleteAccount = useDeleteAccount(deleteId ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) { setFormError("Account name is required."); return; }
    if (isNaN(parseFloat(form.balance))) { setFormError("Enter a valid balance."); return; }

    // Determine linked_mortgage_id for property accounts
    let resolvedLinkedMortgageId: string | null = null;
    if (form.type === "property" && form.link_mortgage) {
      if (form.mortgage_link_mode === "existing") {
        if (!form.linked_mortgage_id) {
          setFormError("Select a mortgage account to link.");
          return;
        }
        resolvedLinkedMortgageId = form.linked_mortgage_id;
      }
    } else if (form.type === "property" && !form.link_mortgage) {
      resolvedLinkedMortgageId = null; // explicit unlink when editing
    }

    const payload: AccountCreateInput = {
      name: form.name,
      type: form.type,
      current_balance: LIABILITY_TYPES.includes(form.type)
        ? -Math.abs(parseFloat(form.balance))
        : parseFloat(form.balance),
      institution: form.institution || null,
      account_number: form.account_number || null,
      notes: form.notes || null,
      color: form.color,
      linked_mortgage_id: resolvedLinkedMortgageId,
    };

    const isCreatingLinkedMortgage =
      form.type === "property" &&
      form.link_mortgage &&
      form.mortgage_link_mode === "new";
    const hasAnyMortgageDetails = Boolean(
      form.original_principal ||
      form.interest_rate ||
      form.term_months ||
      form.origination_date ||
      form.extra_payment ||
      form.loan_type
    );
    let mortgage: MortgageCreateInput | null = null;
    if ((isMortgage && hasAnyMortgageDetails) || isCreatingLinkedMortgage) {
      if (
        !form.original_principal ||
        !form.interest_rate ||
        !form.term_months ||
        !form.origination_date
      ) {
        setFormError("Principal, interest rate, term, and start date are required for mortgage details.");
        return;
      }
      mortgage = {
        original_principal: parseFloat(form.original_principal),
        interest_rate: parseFloat(form.interest_rate),
        term_months: parseInt(form.term_months),
        start_date: form.origination_date,
        extra_payment: form.extra_payment ? parseFloat(form.extra_payment) : 0,
        loan_type: form.type === "loan" ? form.loan_type || null : null,
      };
    }

    const requestBody = {
      account: payload,
      mortgage: isMortgage ? mortgage : null,
      new_linked_mortgage: isCreatingLinkedMortgage
        ? {
            name: form.new_mortgage_name.trim() || `${form.name} Mortgage`,
            mortgage: mortgage!,
          }
        : null,
    };

    setIsSaving(true);
    try {
      const savedAccount = editAccount
        ? await updateAccountWithMortgage(editAccount.id, requestBody)
        : await createAccountWithMortgage(requestBody);
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts", savedAccount.id] });
      queryClient.invalidateQueries({ queryKey: ["mortgage", savedAccount.id] });
      setAddOpen(false);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      setFormError(
        typeof detail === "string" ? detail : "Failed to save account. Please try again."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteAccount.mutateAsync();
      setDeleteOpen(false);
      setDeleteId(null);
      setDeleteError(null);
    } catch (err: unknown) {
      const response = (err as { response?: { status?: number; data?: { detail?: string } } }).response;
      const msg = response?.data?.detail;
      if (response?.status === 409 && msg) {
        setDeleteError(msg);
      } else {
        setDeleteOpen(false);
        setDeleteError(null);
      }
    }
  }

  if (isLoading) return <Spinner />;
  if (isError) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-4 py-3">
        Failed to load accounts.
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{accountList.length} accounts</p>
        <Button size="sm" onClick={openAdd} className="flex items-center gap-1">
          <Plus className="h-4 w-4" />
          Add Account
        </Button>
      </div>

      {accountList.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No accounts yet. Add your first account to get started.
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Balance</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {accountList.map((account) => (
                  <tr
                    key={account.id}
                    className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                    onClick={() => setTxDialog({ id: account.id, name: account.name })}
                  >
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: account.color ?? "#6B7280" }}
                        />
                        <span>{account.name}</span>
                        {!account.is_active && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground capitalize">{account.type.replace("_", " ")}</td>
                    <td className={cn("px-4 py-3 text-right font-semibold", account.current_balance < 0 ? "text-destructive" : "text-foreground")}>
                      {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(account.current_balance)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); openEdit(account); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); setDeleteId(account.id); setDeleteOpen(true); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg flex flex-col top-4 bottom-4 translate-y-0 sm:bottom-auto sm:top-[50svh] sm:-translate-y-1/2 sm:max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>{editAccount ? "Edit Account" : "Add Account"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
            <div className="overflow-y-auto flex-1 min-h-0">
            <div className="space-y-4 py-2">
              {formError && (
                <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-3 py-2">
                  {formError}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2">
                  <Label>Account Name</Label>
                  <Input
                    placeholder="e.g. Chase Checking"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as AccountType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.color}
                      onChange={(e) => setForm({ ...form, color: e.target.value })}
                      className="h-9 w-14 rounded border border-input cursor-pointer"
                    />
                    <span className="text-sm text-muted-foreground">{form.color}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>{form.type === 'property' ? 'Property Value ($)' : 'Current Balance ($)'}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={form.balance}
                    onChange={(e) => setForm({ ...form, balance: e.target.value })}
                    required
                  />
                  {LIABILITY_TYPES.includes(form.type) && (
                    <p className="text-xs text-muted-foreground">
                      Enter the amount owed as a positive number — it will be stored as a negative balance.
                    </p>
                  )}
                </div>
                {form.type !== 'property' && (
                  <>
                    <div className="space-y-1">
                      <Label>Institution</Label>
                      <Input
                        placeholder="e.g. Chase Bank"
                        value={form.institution}
                        onChange={(e) => setForm({ ...form, institution: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Account Number (last 4)</Label>
                      <Input
                        placeholder="••••1234"
                        maxLength={20}
                        value={form.account_number}
                        onChange={(e) => setForm({ ...form, account_number: e.target.value })}
                      />
                    </div>
                  </>
                )}
                <div className="space-y-1 col-span-2">
                  <Label>Notes</Label>
                  <Input
                    placeholder="Optional"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
              </div>

              {/* Property → Mortgage Link */}
              {form.type === "property" && (
                <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Link to Mortgage</p>
                      <p className="text-xs text-muted-foreground">Associate this property with a mortgage account</p>
                    </div>
                    <Switch
                      checked={form.link_mortgage}
                      onCheckedChange={(v) => setForm({ ...form, link_mortgage: v })}
                    />
                  </div>

                  {form.link_mortgage && (
                    <div className="space-y-3 pt-1">
                      {/* Mode selector */}
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer text-sm">
                          <input
                            type="radio"
                            name="mortgage_link_mode"
                            value="existing"
                            checked={form.mortgage_link_mode === "existing"}
                            onChange={() => setForm({ ...form, mortgage_link_mode: "existing" })}
                          />
                          Link existing
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-sm">
                          <input
                            type="radio"
                            name="mortgage_link_mode"
                            value="new"
                            checked={form.mortgage_link_mode === "new"}
                            onChange={() => setForm({ ...form, mortgage_link_mode: "new" })}
                          />
                          Create new
                        </label>
                      </div>

                      {form.mortgage_link_mode === "existing" && (
                        <div className="space-y-1">
                          <Label>Mortgage Account</Label>
                          {mortgageAccounts.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No mortgage accounts found. Create one first or use "Create new".</p>
                          ) : (
                            <Select
                              value={form.linked_mortgage_id}
                              onValueChange={(v) => setForm({ ...form, linked_mortgage_id: v })}
                            >
                              <SelectTrigger><SelectValue placeholder="Select mortgage…" /></SelectTrigger>
                              <SelectContent>
                                {mortgageAccounts.map((a) => (
                                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      )}

                      {form.mortgage_link_mode === "new" && (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <Label>Mortgage Account Name</Label>
                            <Input
                              placeholder={`${form.name || "Property"} Mortgage`}
                              value={form.new_mortgage_name}
                              onChange={(e) => setForm({ ...form, new_mortgage_name: e.target.value })}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label>Original Principal ($)</Label>
                              <Input
                                type="number" step="0.01" placeholder="e.g. 350000"
                                value={form.original_principal}
                                onChange={(e) => setForm({ ...form, original_principal: e.target.value })}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label>Interest Rate (%)</Label>
                              <Input
                                type="number" step="0.001" placeholder="e.g. 6.5"
                                value={form.interest_rate}
                                onChange={(e) => setForm({ ...form, interest_rate: e.target.value })}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label>Term (months)</Label>
                              <Input
                                type="number" step="1" placeholder="e.g. 360"
                                value={form.term_months}
                                onChange={(e) => setForm({ ...form, term_months: e.target.value })}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label>Extra Monthly Payment ($)</Label>
                              <Input
                                type="number" step="0.01" placeholder="e.g. 200"
                                value={form.extra_payment}
                                onChange={(e) => setForm({ ...form, extra_payment: e.target.value })}
                              />
                            </div>
                            <div className="space-y-1 col-span-2">
                              <Label>Origination Date</Label>
                              <Input
                                type="date"
                                value={form.origination_date}
                                onChange={(e) => setForm({ ...form, origination_date: e.target.value })}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Mortgage/Loan Detail Fields */}
              {isMortgage && (
                <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {form.type === "loan" ? "Loan Details" : "Mortgage Details"}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {form.type === "loan" && (
                      <div className="space-y-1 col-span-2">
                        <Label>Loan Type</Label>
                        <Select
                          value={form.loan_type}
                          onValueChange={(v) => setForm({ ...form, loan_type: v })}
                        >
                          <SelectTrigger><SelectValue placeholder="Select loan type…" /></SelectTrigger>
                          <SelectContent>
                            {LOAN_TYPES.map((lt) => (
                              <SelectItem key={lt.value} value={lt.value}>{lt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label>Original Principal ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="e.g. 350000"
                        value={form.original_principal}
                        onChange={(e) => setForm({ ...form, original_principal: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Interest Rate (%)</Label>
                      <Input
                        type="number"
                        step="0.001"
                        placeholder="e.g. 6.5"
                        value={form.interest_rate}
                        onChange={(e) => setForm({ ...form, interest_rate: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Term (months)</Label>
                      <Input
                        type="number"
                        step="1"
                        placeholder="e.g. 360"
                        value={form.term_months}
                        onChange={(e) => setForm({ ...form, term_months: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Extra Monthly Payment ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="e.g. 200"
                        value={form.extra_payment}
                        onChange={(e) => setForm({ ...form, extra_payment: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label>Origination Date</Label>
                      <Input
                        type="date"
                        value={form.origination_date}
                        onChange={(e) => setForm({ ...form, origination_date: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
            </div>
            <DialogFooter className="pt-4">
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Saving…" : "Save Account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Transaction List Dialog */}
      {txDialog && (
        <TransactionListDialog
          open={true}
          onOpenChange={(o) => { if (!o) setTxDialog(null); }}
          title={txDialog.name}
          filter={{ kind: "account", id: txDialog.id }}
        />
      )}

      {/* Delete Confirm */}
      <Dialog open={deleteOpen} onOpenChange={(open) => { setDeleteOpen(open); if (!open) setDeleteError(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Account?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the account and may affect related transactions.
          </p>
          {deleteError && (
            <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-3 py-2">
              {deleteError}
            </div>
          )}
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteAccount.isPending}>
              {deleteAccount.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
