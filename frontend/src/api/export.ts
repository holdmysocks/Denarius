import api from "./client";

export interface ExportParams {
  include_categories?: boolean;
  include_accounts?: boolean;
  include_expense_accounts?: boolean;
  include_recurring?: boolean;
  include_budgets?: boolean;
  include_settings?: boolean;
  include_mortgage?: boolean;
  include_networth?: boolean;
  include_transactions?: boolean;
  transaction_start_date?: string;
  transaction_end_date?: string;
}

export interface ImportResult {
  imported: Record<string, number>;
  skipped: Record<string, number>;
  errors: string[];
}

export async function exportData(params: ExportParams): Promise<void> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== false) {
      query.set(key, String(value));
    }
  }

  const response = await api.get(`/export?${query.toString()}`, {
    responseType: "blob",
  });

  const disposition = response.headers["content-disposition"] ?? "";
  const match = disposition.match(/filename=([^\s;]+)/);
  const filename = match ? match[1] : "denarius-export.json";

  const url = URL.createObjectURL(response.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importData(file: File): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  const response = await api.post("/import", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data as ImportResult;
}
