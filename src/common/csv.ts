/** UTF-8 BOM so Excel on Windows renders ₱ instead of â‚±. */
export const CSV_BOM = '﻿';

/**
 * RFC 4180 quoting, plus a guard against spreadsheet formula injection.
 *
 * A transaction note is user-controlled text that lands in Excel. A value
 * starting with = + - or @ is interpreted as a formula, so it gets a leading
 * apostrophe. This is a real (if low-stakes here) injection vector, and it
 * costs one line.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);

  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }

  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvRow(values: (string | number | null | undefined)[]): string {
  return values.map(csvField).join(',');
}
