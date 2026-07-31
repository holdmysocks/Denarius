import { describe, expect, it } from "vitest";
import {
  effectiveTransactionType,
  isPairedTransaction,
  isPairedTransfer,
} from "./transactions";

describe("persisted transfer normalization", () => {
  it("normalizes a paired expense leg to transfer", () => {
    const transaction = {
      type: "expense" as const,
      paired_transaction_id: "paired-id",
      transfer_account_id: "other-account-id",
    };

    expect(isPairedTransfer(transaction)).toBe(true);
    expect(effectiveTransactionType(transaction)).toBe("transfer");
  });

  it("normalizes a paired income leg to transfer", () => {
    expect(effectiveTransactionType({
      type: "income",
      paired_transaction_id: "paired-id",
      transfer_account_id: "other-account-id",
    })).toBe("transfer");
  });

  it("does not treat an unrelated paired transaction as a transfer", () => {
    const transaction = {
      type: "expense",
      paired_transaction_id: "paired-id",
      transfer_account_id: null,
    } as const;

    expect(isPairedTransaction(transaction)).toBe(true);
    expect(isPairedTransfer(transaction)).toBe(false);
    expect(effectiveTransactionType(transaction)).toBe("expense");
  });
});
