export type TTransactionRef = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
};

export type TTransaction = {
  id: string;
  type: 'income' | 'expense';
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
  recurringRuleId: string | null;
  isEdited: boolean;
  category: TTransactionRef;
  account: TTransactionRef;
};

export type TTransactionSummary = {
  incomeCentavos: number;
  expenseCentavos: number;
  netCentavos: number;
  count: number;
};
