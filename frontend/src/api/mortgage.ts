import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "./client";

export interface MortgageCreateInput {
  original_principal: number;
  interest_rate: number;
  term_months: number;
  start_date: string;
  extra_payment?: number;
  loan_type?: string | null;
}

export type MortgageUpdateInput = Partial<MortgageCreateInput>;

export interface MortgageOut {
  id: string;
  account_id: string;
  original_principal: number;
  interest_rate: number;
  term_months: number;
  start_date: string;
  extra_payment: number;
  loan_type: string | null;
}

export interface AmortizationRow {
  payment_number: number;
  payment_date: string;
  payment_amount: number;
  principal: number;
  interest: number;
  balance: number;
  cumulative_interest: number;
}

export interface ExtraPaymentCalcResult {
  months_saved: number;
  interest_saved: number;
  new_payoff_date: string;
}

export interface MortgagePaymentInput {
  source_account_id: string;
  source_amount: number;
  mortgage_amount: number;
  date: string;
  description?: string;
}

export interface MortgagePaymentResult {
  source_transaction_id: string;
  mortgage_transaction_id: string;
}

export async function getMortgage(accountId: string): Promise<MortgageOut> {
  return (await api.get<MortgageOut>(`/accounts/${accountId}/mortgage`)).data;
}

export function useMortgage(accountId: string) {
  return useQuery<MortgageOut>({
    queryKey: ["mortgage", accountId],
    queryFn: () => getMortgage(accountId),
    enabled: !!accountId,
  });
}

export function useAmortization(
  accountId: string,
  extraPayment?: number,
  enabled = true
) {
  return useQuery<AmortizationRow[]>({
    queryKey: ["mortgage", accountId, "amortization", extraPayment],
    queryFn: () =>
      api
        .get<AmortizationRow[]>(`/accounts/${accountId}/mortgage/amortization`, {
          params:
            extraPayment !== undefined ? { extra_payment: extraPayment } : {},
        })
        .then((r) => r.data),
    enabled: !!accountId && enabled,
  });
}

export function useRemainingAmortization(
  accountId: string,
  extraPayment?: number,
  enabled = true
) {
  return useQuery<AmortizationRow[]>({
    queryKey: ["mortgage", accountId, "amortization", "remaining", extraPayment],
    queryFn: () =>
      api
        .get<AmortizationRow[]>(`/accounts/${accountId}/mortgage/amortization`, {
          params: {
            from_current_balance: true,
            ...(extraPayment !== undefined ? { extra_payment: extraPayment } : {}),
          },
        })
        .then((r) => r.data),
    enabled: !!accountId && enabled,
  });
}

export function useCreateMortgage(accountId: string) {
  const qc = useQueryClient();
  return useMutation<MortgageOut, Error, MortgageCreateInput>({
    mutationFn: (data) =>
      api.post<MortgageOut>(`/accounts/${accountId}/mortgage`, data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mortgage", accountId] }),
  });
}

export function useUpdateMortgage(accountId: string) {
  const qc = useQueryClient();
  return useMutation<MortgageOut, Error, MortgageUpdateInput>({
    mutationFn: (data) =>
      api.put<MortgageOut>(`/accounts/${accountId}/mortgage`, data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mortgage", accountId] }),
  });
}

export function useRecordMortgagePayment(accountId: string) {
  const qc = useQueryClient();
  return useMutation<MortgagePaymentResult, Error, MortgagePaymentInput>({
    mutationFn: (data) =>
      api
        .post<MortgagePaymentResult>(`/accounts/${accountId}/mortgage/record-payment`, data)
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["mortgage", accountId, "amortization", "remaining"] });
      qc.invalidateQueries({ queryKey: ["networth"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["recurring"] });
    },
  });
}

export function useExtraPaymentCalc(accountId: string) {
  return useMutation<ExtraPaymentCalcResult, Error, number>({
    mutationFn: (extraMonthly: number) =>
      api
        .post<ExtraPaymentCalcResult>(`/accounts/${accountId}/mortgage/extra-payment-calc`, { extra_monthly: extraMonthly })
        .then((r) => r.data),
  });
}
