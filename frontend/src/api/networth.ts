import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "./client";

type ApiMoney = number | string;

interface NetWorthAccountResponse {
  account_id: string;
  account_name: string;
  account_type: string;
  balance: ApiMoney;
  is_asset: boolean;
}

interface NetWorthCurrentResponse {
  net_worth: ApiMoney;
  total_assets: ApiMoney;
  total_liabilities: ApiMoney;
  accounts: NetWorthAccountResponse[];
}

interface NetWorthSnapshotResponse {
  id: string;
  snapshot_date: string;
  net_worth: ApiMoney;
  total_assets: ApiMoney;
  total_liabilities: ApiMoney;
  account_breakdown: unknown[];
}

export interface NetWorthAccount {
  account_id: string;
  account_name: string;
  account_type: string;
  balance: number;
  is_asset: boolean;
}

export interface NetWorthCurrent {
  net_worth: number;
  total_assets: number;
  total_liabilities: number;
  accounts: NetWorthAccount[];
}

export interface NetWorthSnapshot {
  id: string;
  snapshot_date: string;
  net_worth: number;
  total_assets: number;
  total_liabilities: number;
  account_breakdown: unknown[];
}

function money(value: ApiMoney): number {
  return Number(value);
}

function normalizeSnapshot(snapshot: NetWorthSnapshotResponse): NetWorthSnapshot {
  return {
    ...snapshot,
    net_worth: money(snapshot.net_worth),
    total_assets: money(snapshot.total_assets),
    total_liabilities: money(snapshot.total_liabilities),
  };
}

export function useNetWorthCurrent() {
  return useQuery<NetWorthCurrent>({
    queryKey: ["networth", "current"],
    queryFn: () =>
      api.get<NetWorthCurrentResponse>("/networth/current").then((r) => ({
        net_worth: money(r.data.net_worth),
        total_assets: money(r.data.total_assets),
        total_liabilities: money(r.data.total_liabilities),
        accounts: r.data.accounts.map((account) => ({
          ...account,
          balance: money(account.balance),
        })),
      })),
  });
}

export function useNetWorthHistory(months: number = 12) {
  return useQuery<NetWorthSnapshot[]>({
    queryKey: ["networth", "history", months],
    queryFn: () =>
      api.get<NetWorthSnapshotResponse[]>("/networth/history", { params: { months } }).then((r) =>
        r.data.map(normalizeSnapshot)
      ),
  });
}

export function useCreateSnapshot() {
  const qc = useQueryClient();
  return useMutation<NetWorthSnapshot, Error, string | undefined>({
    mutationFn: (date?: string) =>
      api.post<NetWorthSnapshotResponse>("/networth/snapshot", null, {
        params: date ? { snapshot_date: date } : {},
      }).then((r) => normalizeSnapshot(r.data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["networth"] }),
  });
}
