/**
 * CSV files made in the browser (small tables); big exports come from the
 * API, which writes them the same way.
 *
 * A cell a spreadsheet would read as a formula (it starts with = + - @, a
 * tab or a carriage return) gets an apostrophe in front, so a participant
 * who names their team `=HYPERLINK(...)` cannot run anything on the
 * organiser's machine (CSV injection). A byte-order mark makes Excel read
 * Azerbaijani and Russian letters; lines end in CRLF as Excel expects.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = Array.isArray(value) ? value.join("; ") : typeof value === "object" ? JSON.stringify(value) : String(value);
  // Numbers are left alone (a negative score is not a formula).
  if (typeof value !== "number" && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV<T extends object>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
): string {
  const header = columns.map((c) => csvCell(String(c.header))).join(",");
  const body = rows.map((row) => columns.map((c) => csvCell((row as Record<string, unknown>)[c.key as string])).join(","));
  return [header, ...body].join("\r\n");
}

export function downloadCSV(filename: string, content: string) {
  const blob = new Blob(["﻿", content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
