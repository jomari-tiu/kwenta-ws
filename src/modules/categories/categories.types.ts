import type { TCategoryKind } from '../../db/schema/index.js';

export type TCategory = {
  id: string;
  name: string;
  kind: TCategoryKind;
  icon: string | null;
  color: string | null;
  monthlyBudgetCentavos: number | null;
  sortOrder: number;
  isArchived: boolean;
  transactionCount: number;
};

export type TDeleteCategoryResult =
  { deleted: true } | { archived: true; referenceCount: number };
