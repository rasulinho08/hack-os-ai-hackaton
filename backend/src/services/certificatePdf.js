/**
 * @file certificatePdf.js
 * @description One certificate as a PDF page: A4 landscape in the event's
 * colour, the recipient, what they did, who signed it, and a QR code that
 * opens the public verification page.
 *
 * Words come in the event's language (Azerbaijani, English or Russian).
 * Sentences are built so that names never need a case ending or a gender:
 * an event or team name can be anything an organiser typed.
 */

const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, setCharacterSpacing } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const qrcode = require('qrcode-generator');
const { fonts } = require('../utils/pdfFonts');

const KINDS = ['participation', 'winner', 'special', 'judge', 'mentor', 'volunteer'];

const MONTHS = {
  az: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
};

/** "1-ci", "3-cü", "6-cı", "9-cu" — the suffix follows the last number word's vowel. */
function azOrdinal(n) {
  const units = { 1: 'ci', 2: 'ci', 3: 'cü', 4: 'cü', 5: 'ci', 6: 'cı', 7: 'ci', 8: 'ci', 9: 'cu' };
  const tens = { 1: 'cu', 2: 'ci', 3: 'cu', 4: 'cı', 5: 'ci', 6: 'cı', 7: 'ci', 8: 'ci', 9: 'cı' };
  let suffix;
  if (n % 10) suffix = units[n % 10];
  else if (n % 100) suffix = tens[(n % 100) / 10];
  else suffix = n % 1000 ? 'cü' : 'ci';
  return `${n}-${suffix}`;
}

function enOrdinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${s}`;
}

const WORDS = {
  az: {
    title: 'SERTİFİKAT',
    sub: {
      participation: 'İştirak sertifikatı', winner: 'Qalib sertifikatı', special: 'Xüsusi mükafat',
      judge: 'Münsif sertifikatı', mentor: 'Mentor sertifikatı', volunteer: 'Könüllü sertifikatı',
      // A place in the ranking when the event set no prize for it.
      placed: 'Nailiyyət sertifikatı',
    },
    lead: 'Bu sertifikat təsdiq edir ki,',
    body: {
      participation: (c) => (c.team ? `“${c.event}” tədbirində ${c.team} komandası ilə iştirak etmişdir.` : `“${c.event}” tədbirində iştirak etmişdir.`),
      winner: (c) => `“${c.event}” tədbirində${c.team ? ` ${c.team} komandası ilə` : ''} ${azOrdinal(c.place)} yerə layiq görülmüşdür.`,
      special: (c) => `“${c.event}” tədbirində “${c.prize}” mükafatına layiq görülmüşdür.`,
      judge: (c) => `“${c.event}” tədbirində münsif kimi iştirak etmişdir.`,
      mentor: (c) => `“${c.event}” tədbirində mentor kimi iştirakçılara dəstək olmuşdur.`,
      volunteer: (c) => `“${c.event}” tədbirində könüllü kimi fəaliyyət göstərmişdir.`,
    },
    project: 'Layihə',
    verify: 'Yoxlama',
    code: 'Kod',
    issued: 'Verilib',
  },
  en: {
    title: 'CERTIFICATE',
    sub: {
      participation: 'Certificate of participation', winner: 'Certificate of achievement', special: 'Special award',
      judge: 'Certificate of appreciation · Judge', mentor: 'Certificate of appreciation · Mentor', volunteer: 'Certificate of appreciation · Volunteer',
      placed: 'Certificate of achievement',
    },
    lead: 'This is to certify that',
    body: {
      participation: (c) => (c.team ? `took part in ${c.event} with team ${c.team}.` : `took part in ${c.event}.`),
      winner: (c) => `${c.prize ? 'won' : 'took'} ${enOrdinal(c.place)} place at ${c.event}${c.team ? ` with team ${c.team}` : ''}.`,
      special: (c) => `received the “${c.prize}” award at ${c.event}.`,
      judge: (c) => `served as a judge at ${c.event}.`,
      mentor: (c) => `mentored the participants of ${c.event}.`,
      volunteer: (c) => `volunteered at ${c.event}.`,
    },
    project: 'Project',
    verify: 'Verify',
    code: 'Code',
    issued: 'Issued',
  },
  ru: {
    title: 'СЕРТИФИКАТ',
    sub: {
      participation: 'Сертификат участника', winner: 'Сертификат победителя', special: 'Специальная награда',
      judge: 'Сертификат члена жюри', mentor: 'Сертификат ментора', volunteer: 'Сертификат волонтёра',
      placed: 'Сертификат о достижении',
    },
    lead: 'Настоящий сертификат подтверждает:',
    body: {
      participation: (c) => (c.team ? `участие в мероприятии «${c.event}» в составе команды «${c.team}».` : `участие в мероприятии «${c.event}».`),
      winner: (c) => `${c.place}-е место на мероприятии «${c.event}»${c.team ? ` в составе команды «${c.team}»` : ''}.`,
      special: (c) => `награда «${c.prize}» на мероприятии «${c.event}».`,
      judge: (c) => `работа в жюри мероприятия «${c.event}».`,
      mentor: (c) => `менторская поддержка участников мероприятия «${c.event}».`,
      volunteer: (c) => `волонтёрская работа на мероприятии «${c.event}».`,
    },
    project: 'Проект',
    verify: 'Проверка',
    code: 'Код',
    issued: 'Выдан',
  },
};

/** The calendar day of `d` in `timeZone` (the event's; UTC without one): { y, m (0–11), d }. */
function dayIn(d, timeZone) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || 'UTC', year: 'numeric', month: 'numeric', day: 'numeric',
    }).formatToParts(d).map((p) => [p.type, Number(p.value)]));
    return { y: parts.year, m: parts.month - 1, d: parts.day };
  } catch {
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
  }
}

function dateLine(lang, d, timeZone) {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const m = MONTHS[lang] || MONTHS.en;
  const day = dayIn(x, timeZone);
  return `${day.d} ${m[day.m]} ${day.y}`;
}

/** "#C8102E" → rgb(); anything else → the HackOS red. */
function colour(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return rgb(200 / 255, 16 / 255, 46 / 255);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const INK = rgb(0.08, 0.09, 0.11);
const INK2 = rgb(0.3, 0.32, 0.37);
const INK3 = rgb(0.47, 0.49, 0.54);
const LINE = rgb(0.86, 0.86, 0.88);

/** Split text into lines no wider than `max`. */
function wrap(text, font, size, max) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= max || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * @param {object} c
 * @param {'participation'|'winner'|'special'|'judge'|'mentor'|'volunteer'} c.kind
 * @param {string} c.name        the recipient
 * @param {string} c.event       the event's name
 * @param {string} [c.team]
 * @param {string} [c.project]
 * @param {number} [c.place]     1, 2, 3… for winners
 * @param {string} [c.prize]     the special award's name
 * @param {string} c.code        the verification code
 * @param {string} c.verifyUrl   the public page that confirms it
 * @param {string} [c.lang]      az | en | ru (default az)
 * @param {string} [c.colour]    the event's brand colour (#RRGGBB)
 * @param {string|Date} [c.issuedAt]
 * @param {string} [c.place_line] where and when, e.g. "Bakı · 25–27 aprel 2026"
 * @param {{ name?: string, title?: string }} [c.signer]
 * @param {string} [c.note]      an extra line the organiser added
 * @param {{ bytes: Uint8Array|Buffer, mime: string }} [c.signature] the signer's image (PNG or JPEG)
 * @returns {Promise<Uint8Array>}
 */
async function renderCertificatePdf(c) {
  if (!KINDS.includes(c.kind)) throw new Error(`certificate kind ${c.kind}`);
  const lang = WORDS[c.lang] ? c.lang : 'az';
  const w = WORDS[lang];
  const accent = colour(c.colour);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { regular: regularBytes, bold: boldBytes } = fonts();
  // Subsetting with @pdf-lib/fontkit drops glyphs; the whole font is embedded (as for invoices).
  const regular = await doc.embedFont(regularBytes, { subset: false });
  const bold = await doc.embedFont(boldBytes, { subset: false });
  doc.setTitle(`${w.title} · ${c.name} · ${c.event}`);
  doc.setSubject(w.sub[c.kind]);
  doc.setAuthor(c.event);
  doc.setCreator('HackOS');
  doc.setProducer('HackOS');
  if (c.issuedAt) doc.setCreationDate(new Date(c.issuedAt));

  const W = 841.89;
  const H = 595.28;
  const page = doc.addPage([W, H]);

  const centre = (text, y, { size, font = regular, color = INK, spacing = 0 }) => {
    const s = String(text ?? '');
    const width = font.widthOfTextAtSize(s, size) + spacing * Math.max(0, [...s].length - 1);
    if (spacing) page.pushOperators(pushGraphicsState(), setCharacterSpacing(spacing));
    page.drawText(s, { x: (W - width) / 2, y, size, font, color });
    if (spacing) page.pushOperators(popGraphicsState());
  };

  // Frame: an accent border and a fine inner line.
  page.drawRectangle({ x: 18, y: 18, width: W - 36, height: H - 36, borderColor: accent, borderWidth: 2.2 });
  page.drawRectangle({ x: 28, y: 28, width: W - 56, height: H - 56, borderColor: LINE, borderWidth: 0.7 });
  page.drawRectangle({ x: 28, y: H - 34, width: W - 56, height: 6, color: accent });

  // The event, small, and the certificate's number.
  page.drawText(String(c.event).toUpperCase().slice(0, 70), { x: 52, y: H - 66, size: 9.5, font: bold, color: INK3 });
  const no = `${w.code}: ${c.code}`;
  page.drawText(no, { x: W - 52 - regular.widthOfTextAtSize(no, 9.5), y: H - 66, size: 9.5, font: regular, color: INK3 });

  centre(w.title, H - 138, { size: 40, font: bold, color: INK, spacing: 7 });
  // "Winner" only for a place the event gave a prize for; the results page
  // lists prize winners, and a ranked place without one is an achievement.
  centre(c.kind === 'winner' && !c.prize ? w.sub.placed : w.sub[c.kind], H - 168, { size: 14, font: bold, color: accent });
  centre(w.lead, H - 214, { size: 12.5, color: INK2 });

  // The name, as large as fits.
  let nameSize = 36;
  while (nameSize > 20 && bold.widthOfTextAtSize(c.name, nameSize) > W - 220) nameSize -= 1;
  centre(c.name, H - 262, { size: nameSize, font: bold });
  page.drawRectangle({ x: (W - 140) / 2, y: H - 280, width: 140, height: 1.6, color: accent });

  const body = w.body[c.kind]({ ...c, place: Number(c.place) || 1, prize: c.prize || '' });
  const lines = wrap(body, regular, 14, 580);
  let y = H - 316;
  for (const l of lines.slice(0, 3)) {
    centre(l, y, { size: 14, color: INK2 });
    y -= 21;
  }
  if (c.project && (c.kind === 'winner' || c.kind === 'participation' || c.kind === 'special')) {
    centre(`${w.project}: ${c.project}`.slice(0, 110), y - 2, { size: 12, color: INK3 });
    y -= 20;
  }
  if (c.note) {
    for (const l of wrap(c.note, regular, 11, 560).slice(0, 2)) {
      centre(l, y - 4, { size: 11, color: INK3 });
      y -= 16;
    }
  }

  // Bottom: where and when (left), who signed (centre), how to check it (right).
  const baseY = 78;
  const leftX = 60;
  const issued = dateLine(lang, c.issuedAt, c.timeZone);
  if (c.place_line) page.drawText(String(c.place_line).slice(0, 60), { x: leftX, y: baseY + 18, size: 10.5, font: bold, color: INK });
  if (issued) page.drawText(`${w.issued}: ${issued}`, { x: leftX, y: baseY, size: 10, font: regular, color: INK3 });

  // The signature image, if the organiser uploaded one, sits above the line.
  if (c.signature && c.signature.bytes) {
    try {
      const mime = String(c.signature.mime || '').toLowerCase();
      const img = mime.includes('png') ? await doc.embedPng(c.signature.bytes)
        : mime.includes('jpeg') || mime.includes('jpg') ? await doc.embedJpg(c.signature.bytes) : null;
      if (img) {
        const scale = Math.min(170 / img.width, 46 / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x: W / 2 - w / 2, y: baseY + 38, width: w, height: h });
      }
    } catch (err) {
      console.warn('[certificate] signature image skipped:', err.message);
    }
  }

  if (c.signer && (c.signer.name || c.signer.title)) {
    page.drawLine({ start: { x: W / 2 - 110, y: baseY + 34 }, end: { x: W / 2 + 110, y: baseY + 34 }, thickness: 0.8, color: INK3 });
    if (c.signer.name) centre(String(c.signer.name).slice(0, 60), baseY + 16, { size: 11.5, font: bold });
    if (c.signer.title) centre(String(c.signer.title).slice(0, 70), baseY, { size: 9.5, color: INK3 });
  }

  // QR code (vector squares, crisp at any zoom) and the address beside it.
  const qr = qrcode(0, 'M');
  qr.addData(c.verifyUrl);
  qr.make();
  const count = qr.getModuleCount();
  const side = 74;
  const cell = side / count;
  const qx = W - 60 - side;
  const qy = baseY - 18;
  page.drawRectangle({ x: qx - 4, y: qy - 4, width: side + 8, height: side + 8, color: rgb(1, 1, 1) });
  for (let r = 0; r < count; r += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(r, col)) {
        page.drawRectangle({ x: qx + col * cell, y: qy + side - (r + 1) * cell, width: cell + 0.02, height: cell + 0.02, color: INK });
      }
    }
  }
  const label = w.verify;
  const short = String(c.verifyUrl).replace(/^https?:\/\//, '');
  page.drawText(label, { x: qx - 12 - bold.widthOfTextAtSize(label, 9.5), y: qy + 30, size: 9.5, font: bold, color: INK });
  page.drawText(short, { x: qx - 12 - regular.widthOfTextAtSize(short, 8.5), y: qy + 16, size: 8.5, font: regular, color: INK3 });

  return doc.save();
}

/**
 * "25–27 aprel 2026", "25 aprel – 2 may 2026", "27 aprel 2026" in the
 * event's language, on the event's calendar (its time zone): an event that
 * starts at 00:30 in Baku started that day, not the evening before in UTC.
 */
function dateRange(lang, start, end, timeZone) {
  const m = MONTHS[lang] || MONTHS.en;
  const a = start ? new Date(start) : null;
  const b = end ? new Date(end) : null;
  const ok = (d) => d && !Number.isNaN(d.getTime());
  if (!ok(a) && !ok(b)) return '';
  if (!ok(a) || !ok(b)) return dateLine(lang, ok(a) ? a : b, timeZone);
  const da = dayIn(a, timeZone);
  const db = dayIn(b, timeZone);
  if (da.y === db.y && da.m === db.m) {
    return da.d === db.d ? dateLine(lang, a, timeZone) : `${da.d}–${db.d} ${m[da.m]} ${da.y}`;
  }
  return `${da.d} ${m[da.m]} – ${dateLine(lang, b, timeZone)}`;
}

module.exports = { renderCertificatePdf, azOrdinal, enOrdinal, dateRange, KINDS, WORDS };
