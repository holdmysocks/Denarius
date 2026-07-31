import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "./client";

export type CategoryType = "income" | "expense" | "transfer";

export interface CategoryOut {
  id: string;
  name: string;
  type: CategoryType;
  color: string;
  icon: string | null;
  is_system: boolean;
  sort_order: number;
  once_per_month: boolean;
}

export interface CategoryCreate {
  name: string;
  type: CategoryType;
  color?: string;
  icon?: string | null;
  sort_order?: number;
  once_per_month?: boolean;
}

export type CategoryUpdate = Partial<CategoryCreate>;

export function useCategories(type?: CategoryType) {
  return useQuery<CategoryOut[]>({
    queryKey: ["categories", type],
    queryFn: async () => (await api.get<CategoryOut[]>("/categories", {
      params: type ? { type } : {},
    })).data,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation<CategoryOut, Error, CategoryCreate>({
    mutationFn: async (data) => (await api.post<CategoryOut>("/categories", data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export function useUpdateCategory(id: string) {
  const qc = useQueryClient();
  return useMutation<CategoryOut, Error, CategoryUpdate>({
    mutationFn: async (data) => (await api.put<CategoryOut>(`/categories/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await api.delete<void>(`/categories/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}
