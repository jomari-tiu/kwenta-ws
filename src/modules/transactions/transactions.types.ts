export type TTransactionRef = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
};

export type TTransaction = {
  id: string;
  type: 'income' | 'expense' | 'transfer';
  amountCentavos: number;
  txnDate: string;
  note: string | null;
  source: 'manual' | 'recurring' | 'installment';
  /**
   * Set when this expense was created by marking an installment payment paid.
   * The calendar day panel merges such a row with its due row rather than
   * showing the same money twice.
   */
  installmentPaymentId: string | null;
  /**
   * Set when this expense is a credit-loan repayment. Such a row is READ-ONLY
   * in the transactions module: it belongs to the loan, and the loan's balance
   * is derived from it.
   */
  creditLoanId: string | null;
  recurringRuleId: string | null;
  isEdited: boolean;
  /** For a transfer this is a display-only stand-in; the row has no category. */
  category: TTransactionRef;
  /** Source account. For a transfer, the money LEAVES this one. */
  account: TTransactionRef;
  /** Destination account — set only on transfers. */
  transferAccount: TTransactionRef | null;
};

export type TTransactionSummary = {
  incomeCentavos: number;
  expenseCentavos: number;
  netCentavos: number;
  count: number;
};
