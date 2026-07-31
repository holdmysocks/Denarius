import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  useExpenseAccounts,
  useCreateExpenseAccount,
  useUpdateExpenseAccount,
  useDeleteExpenseAccount,
  type ExpenseAccountOut,
} from "@/api/expenseAccounts";
import { TransactionListDialog } from "@/components/TransactionListDialog";

interface ExpenseAccountFormState {
  name: string;
  color: string;
}

const emptyForm = (): ExpenseAccountFormState => ({
  name: "",
  color: "#6B7280",
});

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

export default function ExpenseAccountsPage() {
  const { data: accounts = [], isLoading, isError } = useExpenseAccounts();
  const createAccount = useCreateExpenseAccount();

  const [addOpen, setAddOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<ExpenseAccountOut | null>(null);
  const [form, setForm] = useState<ExpenseAccountFormState>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [txDialog, setTxDialog] = useState<{ id: string; name: string } | null>(null);

  const accountList: ExpenseAccountOut[] = accounts;

  // Auto-open the Transactions dialog when arriving from the global search
  // (/expense-accounts?open=<id>). Fires once per navigation.
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get("open");
  const consumedOpen = useRef(false);
  useEffect(() => {
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

  function openAdd() {
    setEditAccount(null);
    setForm(emptyForm());
    setFormError(null);
    setAddOpen(true);
  }

  function openEdit(account: ExpenseAccountOut) {
    setEditAccount(account);
    setForm({ name: account.name, color: account.color });
    setFormError(null);
    setAddOpen(true);
  }

  const updateAccount = useUpdateExpenseAccount(editAccount?.id ?? "");
  const deleteAccount = useDeleteExpenseAccount(deleteId ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setFormError("Name is required.");
      return;
    }
    const payload = { name: form.name.trim(), color: form.color };
    try {
      if (editAccount) {
        await updateAccount.mutateAsync(payload);
      } else {
        await createAccount.mutateAsync(payload);
      }
      setAddOpen(false);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setFormError(detail ?? "Failed to save. Please try again.");
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
        Failed to load expense accounts.
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{accountList.length} expense accounts</p>
        <Button size="sm" onClick={openAdd} className="flex items-center gap-1">
          <Plus className="h-4 w-4" />
          Add Expense Account
        </Button>
      </div>

      {accountList.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No expense accounts yet. Add vendors, merchants, or payment destinations to track where money goes.
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
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
                          style={{ backgroundColor: account.color }}
                        />
                        <span>{account.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => { e.stopPropagation(); openEdit(account); }}
                        >
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

      {/* Transaction List Dialog */}
      {txDialog && (
        <TransactionListDialog
          open={true}
          onOpenChange={(o) => { if (!o) setTxDialog(null); }}
          title={txDialog.name}
          filter={{ kind: "expense_account", id: txDialog.id }}
        />
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm flex flex-col top-4 bottom-4 translate-y-0 sm:bottom-auto sm:top-[50svh] sm:-translate-y-1/2 sm:max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>{editAccount ? "Edit Expense Account" : "Add Expense Account"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
            <div className="overflow-y-auto flex-1 min-h-0">
            <div className="space-y-4 py-2">
              {formError && (
                <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-3 py-2">
                  {formError}
                </div>
              )}
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  placeholder="e.g. Amazon, Grocery Store"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
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
            </div>
            </div>
            <DialogFooter className="pt-4">
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={createAccount.isPending || updateAccount.isPending}
              >
                {createAccount.isPending || updateAccount.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => { setDeleteOpen(open); if (!open) setDeleteError(null); }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Expense Account?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will remove the expense account. Existing transactions linked to it will not be affected.
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
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteAccount.isPending}
            >
              {deleteAccount.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
