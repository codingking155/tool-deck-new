/** One CSV cell. Quotes when needed, and keeps spreadsheets from reading a value
    as a formula or number: Excel turns "+919876543210" into 9.19877E+11 and runs
    "=…" as a formula, so cells starting with = + - @ get a leading tab (OWASP's
    CSV-injection advice; a tab stays invisible where an apostrophe would show). */
export function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "\t" + s;
  return /[",\n\r\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 byte-order mark so Excel decodes accented country names correctly. */
export const CSV_BOM = "﻿";
