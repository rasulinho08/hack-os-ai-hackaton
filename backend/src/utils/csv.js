/**
 * @file csv.js
 * @description CSV for spreadsheet programs, written row by row.
 *
 * Every export goes through `sendCsv`: values are quoted when they need it,
 * and a cell that a spreadsheet would read as a formula (it starts with
 * = + - @, a tab or a carriage return) is prefixed with an apostrophe, so a
 * participant who names their team `=HYPERLINK(...)` cannot run anything on
 * the organiser's machine (CSV injection). A UTF-8 byte-order mark makes
 * Excel read Azerbaijani and Russian letters correctly.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell, safe to open in Excel, Numbers or Google Sheets. */
function cell(value) {
  if (value === null || value === undefined) return '';
  let s;
  if (value instanceof Date) s = value.toISOString();
  else if (Array.isArray(value)) s = value.join('; ');
  else if (typeof value === 'object') s = JSON.stringify(value);
  else s = String(value);
  // Numbers are left alone (a negative score is not a formula).
  if (typeof value !== 'number' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {Array<{ key: string, header: string, value?: (row) => any }>} columns
 * @param {object} row
 */
function line(columns, row) {
  return `${columns.map((c) => cell(c.value ? c.value(row) : row[c.key])).join(',')}\r\n`;
}

/** The whole file as a string (small exports, tests). */
function toCsv(columns, rows) {
  return `﻿${columns.map((c) => cell(c.header)).join(',')}\r\n${rows.map((r) => line(columns, r)).join('')}`;
}

/** A file name without characters that break the Content-Disposition header. */
function safeName(name) {
  return String(name || 'export').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/-+/g, '-').slice(0, 80) || 'export';
}

/**
 * Send rows as a CSV download, writing as it goes so a large event does not
 * have to fit in memory as one string.
 *
 * @param {import('express').Response} res
 * @param {string} filename  without extension
 * @param {Array} columns    see `line`
 * @param {Iterable|AsyncIterable} rows
 */
async function sendCsv(res, filename, columns, rows) {
  res.status(200).set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${safeName(filename)}.csv"; filename*=UTF-8''${encodeURIComponent(safeName(filename))}.csv`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.write(`﻿${columns.map((c) => cell(c.header)).join(',')}\r\n`);
  for await (const row of rows) {
    if (!res.write(line(columns, row))) {
      await new Promise((resolve) => res.once('drain', resolve));
    }
  }
  res.end();
}

module.exports = { cell, line, toCsv, sendCsv, safeName };
