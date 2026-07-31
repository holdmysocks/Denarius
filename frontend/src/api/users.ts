import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "./client";

export type UserRole = "admin" | "member";

export interface UserOut {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  theme_dark: boolean | null;
  dashboard_hidden_accounts: string[] | null;
}

export interface UserCreate {
  username: string;
  email: string;
  password: string;
  role?: UserRole;
}

export interface UserUpdate {
  username?: string;
  email?: string;
  password?: string;
  is_active?: boolean;
  role?: UserRole;
}

export function useUsers() {
  return useQuery<UserOut[]>({
    queryKey: ["users"],
    queryFn: async () => (await api.get<UserOut[]>("/users")).data,
  });
}

export function useUpdateUser(userId: string) {
  const queryClient = useQueryClient();
  return useMutation<UserOut, Error, UserUpdate>({
    mutationFn: async (data) => (await api.put<UserOut>(`/users/${userId}`, data)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation<UserOut, Error, UserCreate>({
    mutationFn: async (data) => (await api.post<UserOut>("/users", data)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useDeleteUserPermanently() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (userId) => {
      await api.delete<void>(`/users/${userId}/permanent`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}
