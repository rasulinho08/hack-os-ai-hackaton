/**
 * CSV exports: quoting, Unicode, and protection against spreadsheet formulas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { cell, toCsv, safeName } = require('../src/utils/csv');

test('cells that a spreadsheet would run as formulas are neutralised', () => {
  assert.equal(cell('=HYPERLINK("http://x","click")'), `"'=HYPERLINK(""http://x"",""click"")"`);
  assert.equal(cell('+1+1'), "'+1+1");
  assert.equal(cell('-2+3'), "'-2+3");
  assert.equal(cell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(cell('\tcmd'), "'\tcmd");
  assert.equal(cell(-5), '-5', 'a negative number stays a number');
});

test('quotes, separators and new lines are quoted; plain text is not', () => {
  assert.equal(cell('Kod Ustaları'), 'Kod Ustaları');
  assert.equal(cell('a,b'), '"a,b"');
  assert.equal(cell('a;b'), '"a;b"');
  assert.equal(cell('say "hi"'), '"say ""hi"""');
  assert.equal(cell('line1\nline2'), '"line1\nline2"');
  assert.equal(cell(null), '');
  assert.equal(cell(['Python', 'React']), '"Python; React"');
});

test('a whole file starts with a BOM and uses CRLF', () => {
  const out = toCsv([{ key: 'name', header: 'Ad' }, { key: 'score', header: 'Bal' }], [{ name: 'Aysel', score: 9.5 }]);
  assert.ok(out.startsWith('﻿Ad,Bal\r\n'));
  assert.ok(out.endsWith('Aysel,9.5\r\n'));
});

test('file names are safe for the download header', () => {
  assert.equal(safeName('Bakı Hackathon "2026"/participants'), 'Bakı-Hackathon-2026-participants');
  assert.equal(safeName(''), 'export');
});
