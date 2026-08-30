import { CSV_BOM, csvRow } from '../../common/csv.js';
import { todayInAppTz } from '../../common/date.js';
import { centavosToPesoString } from '../../common/money.js';
import * as repo from './transactions.repository.js';
import type { TListTransactionsQuery } from './transactions.schema.js';

/** Guard against an accidental unbounded export. */
const HARD_CAP = 50_000;

const HEADER = [
  'date',
  'type',
  'category',
  'account',
  // Without these two the export cannot be reconciled: a transfer looks like a
  // category-less row with no destination, and a ₱50,000 business cost is
  // indistinguishable from a personal one, so any spreadsheet total
  // double-counts.
  'to account',
  'business',
  'amount',
  'note',
  'source',
];

export async function buildCsv(
  query: TListTransactionsQuery,
): Promise<{ filename: string; body: string; truncated: boolean }> {
  const rows = await repo.streamForExport(query, HARD_CAP + 1);
  const truncated = rows.length > HARD_CAP;
  const exported = truncated ? rows.slice(0, HARD_CAP) : rows;

  const lines = [csvRow(HEADER)];
  for (const r of exported) {
    lines.push(
      csvRow([
        r.txnDate,
        r.type,
        r.categoryName,
        r.accountName,
        r.transferAccountName,
        r.businessName,
        // Peso decimals, not centavos — the single deliberate exception, because
        // the consumer is Excel and the column must import as numeric.
        centavosToPesoString(r.amountCentavos),
        r.note,
        r.source,
      ]),
    );
  }

  return {
    filename: `transactions-${todayInAppTz()}.csv`,
    body: CSV_BOM + lines.join('\r\n') + '\r\n',
    truncated,
  };
}
