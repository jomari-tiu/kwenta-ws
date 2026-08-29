import type { TAccountKind } from '../../db/schema/index.js';

export type TAccount = {
  id: string;
  name: string;
  kind: TAccountKind;
  icon: string | null;
  color: string | null;
  openingBalanceCentavos: number;
  openingBalanceDate: string | null;
  creditLimitCentavos: number | null;
  isDefault: boolean;
  sortOrder: number;
  isArchived: boolean;
  /**
   * opening + income - expense. Server-computed: the client cannot sum a
   * paginated ledger.
   */
  currentBalanceCentavos: number;
};

export type TDeleteAccountResult =
  { deleted: true } | { archived: true; referenceCount: number };
