import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  type CategoryOut,
  type CategoryType,
} from "@/api/categories";
import { TransactionListDialog } from "@/components/TransactionListDialog";

interface CategoryFormState {
  name: string;
  type: CategoryType;
  color: string;
  once_per_month: boolean;
}

const emptyCategoryForm = (): CategoryFormState => ({
  name: "",
  type: "expense",
  color: "#6366f1",
  once_per_month: false,
});

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

export default function CategoriesPage() {
  const { data: categories = [], isLoading, isError } = useCategories();
  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();

  const [addOpen, setAddOpen] = useState(false);
  const [editCategory, setEditCategory] = useState<CategoryOut | null>(null);
  const [form, setForm] = useState<CategoryFormState>(emptyCategoryForm());
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [txDialog, setTxDialog] = useState<{ id: string; name: string } | null>(null);

  const categoryList = categories;

  // Auto-open the Transactions dialog when arriving from the global search
  // (/categories?open=<id>). Fires once per navigation.
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get("open");
  const consumedOpen = useRef(false);
  useEffect(() => {
    if (consumedOpen.current || !openId || categoryList.length === 0) return;
    const cat = categoryList.find((c) => c.id === openId);
    if (cat) {
      consumedOpen.current = true;
      const timeout = window.setTimeout(() => {
        setTxDialog({ id: cat.id, name: cat.name });
        const next = new URLSearchParams(searchParams);
        next.delete("open");
        setSearchParams(next, { replace: true });
      }, 0);
      return () => window.clearTimeout(timeout);
    }
  }, [openId, categoryList, searchParams, setSearchParams]);

  function openAdd() {
    setEditCategory(null);
    setForm(emptyCategoryForm());
    setFormError(null);
    setAddOpen(true);
  }

  function openEdit(cat: CategoryOut) {
    setEditCategory(cat);
    setForm({ name: cat.name, type: cat.type, color: cat.color ?? "#6366f1", once_per_month: cat.once_per_month });
    setFormError(null);
    setAddOpen(true);
  }

  const updateCategory = useUpdateCategory(editCategory?.id ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) { setFormError("Category name is required."); return; }
    try {
      if (editCategory && updateCategory) {
        await updateCategory.mutateAsync({ name: form.name, type: form.type, color: form.color, once_per_month: form.once_per_month });
      } else {
        await createCategory.mutateAsync({ name: form.name, type: form.type, color: form.color, once_per_month: form.once_per_month });
      }
      setAddOpen(false);
    } catch {
      setFormError("Failed to save category.");
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteCategory.mutateAsync(deleteId);
    } catch {
      // ignore
    } finally {
      setDeleteOpen(false);
      setDeleteId(null);
    }
  }

  if (isLoading) return <Spinner />;
  if (isError) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm px-4 py-3">
        Failed to load categories.
      </div>
    );
  }

  const sortedList = [...categoryList].sort((a, b) => a.name.localeCompare(b.name));
  const expenseCategories = sortedList.filter((c) => c.type === "expense");
  const incomeCategories = sortedList.filter((c) => c.type === "income");

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{categoryList.length} categories</p>
        <Button size="sm" onClick={openAdd} className="flex items-center gap-1">
          <Plus className="h-4 w-4" />
          Add Category
        </Button>
      </div>

      {categoryList.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No categories. System categories will appear here.
        </div>
      ) : (
        <div className="space-y-4">
          {[
            { label: "Expense Categories", items: expenseCategories },
            { label: "Income Categories", items: incomeCategories },
          ].map(({ label, items }) =>
            items.length > 0 ? (
              <Card key={label}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    {label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <tbody>
                      {items.map((cat) => (
                        <tr
                          key={cat.id}
                          className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                          onClick={() => setTxDialog({ id: cat.id, name: cat.name })}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {cat.color && (
                                <div
                                  className="w-3 h-3 rounded-full shrink-0"
                                  style={{ backgroundColor: cat.color }}
                                />
                              )}
                              <span className="font-medium">{cat.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground capitalize">
                            <div className="flex items-center gap-2">
                              <span>{cat.type}</span>
                              {cat.once_per_month && (
                                <Badge variant="outline" className="text-xs py-0 border-amber-400 text-amber-600">
                                  1×/mo
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); openEdit(cat); }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={(e) => { e.stopPropagation(); setDeleteId(cat.id); setDeleteOpen(true); }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ) : null
          )}
        </div>
      )}

      {/* Transaction List Dialog */}
      {txDialog && (
        <TransactionListDialog
          open={true}
          onOpenChange={(o) => { if (!o) setTxDialog(null); }}
          title={txDialog.name}
          filter={{ kind: "category", id: txDialog.id }}
        />
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm flex flex-col top-4 bottom-4 translate-y-0 sm:bottom-auto sm:top-[50svh] sm:-translate-y-1/2 sm:max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>{editCategory ? "Edit Category" : "Add Category"}</DialogTitle>
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
                  placeholder="e.g. Groceries"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as CategoryType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">Expense</SelectItem>
                    <SelectItem value="income">Income</SelectItem>
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
              <div className="flex items-center justify-between rounded-md border border-input px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Once per month</p>
                  <p className="text-xs text-muted-foreground">Can only be attached to one recurring bill</p>
                </div>
                <Switch
                  checked={form.once_per_month}
                  onCheckedChange={(v) => setForm({ ...form, once_per_month: v })}
                />
              </div>
            </div>
            </div>
            <DialogFooter className="pt-4">
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={createCategory.isPending || (updateCategory?.isPending ?? false)}>
                {createCategory.isPending || updateCategory?.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Category?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Transactions with this category will become uncategorized.
          </p>
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteCategory.isPending}>
              {deleteCategory.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
