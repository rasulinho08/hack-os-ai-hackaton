/**
 * @file pdfFonts.js
 * @description The fonts HackOS draws its PDFs with (invoices, certificates):
 * Inter, which has every letter of Azerbaijani, English and Russian. Read
 * from assets/fonts once and kept.
 */

const fs = require('fs');
const path = require('path');

const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
let cache = null;

function fonts() {
  if (!cache) {
    cache = {
      regular: fs.readFileSync(path.join(FONT_DIR, 'Inter-Regular.ttf')),
      bold: fs.readFileSync(path.join(FONT_DIR, 'Inter-SemiBold.ttf')),
    };
  }
  return cache;
}

module.exports = { fonts };
