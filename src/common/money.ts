/** Integer centavos. 12345 === ₱123.45. */
export type TCentavos = number;

/**
 * Coerce a Postgres aggregate into a number.
 *
 * This exists because `sum(bigint)` returns `numeric`, which postgres.js gives
 * back as a string — so `"1200" + "800"` silently produces `"1200800"`. Use it
 * at EVERY aggregate select site, without exception.
 */
export function toCentavos(v: string | number | null | undefined): TCentavos {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Exact integer sum. */
export function sumCentavos(...values: TCentavos[]): TCentavos {
  return values.reduce((acc, v) => acc + v, 0);
}

/**
 * Split a total across `parts` so the pieces sum to EXACTLY the total.
 *
 * The remainder lands on the LAST piece, matching how PH lenders amortize:
 * ₱10,000 over 3 → [333333, 333333, 333334].
 */
export function splitCentavos(
  totalCentavos: TCentavos,
  parts: number,
): TCentavos[] {
  if (!Number.isInteger(totalCentavos) || totalCentavos <= 0) {
    throw new Error('splitCentavos: total must be a positive integer');
  }
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new Error('splitCentavos: parts must be a positive integer');
  }
  if (totalCentavos < parts) {
    throw new Error('splitCentavos: total must be at least 1 centavo per part');
  }
  const base = Math.floor(totalCentavos / parts);
  const result = Array.from({ length: parts }, () => base);
  result[parts - 1] = totalCentavos - base * (parts - 1);
  return result;
}

/** Centavos → a plain decimal peso string for CSV. 123450 → "1234.50" */
export function centavosToPesoString(centavos: TCentavos): string {
  const sign = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const pesos = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${pesos}.${frac}`;
}
