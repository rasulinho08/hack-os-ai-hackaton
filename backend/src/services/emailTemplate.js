/**
 * @file emailTemplate.js
 * @description The one layout every HackOS e-mail uses, as HTML and plain text.
 *
 * Content is passed in as data, never as markup, so a team or event name that
 * contains "<" or a quote cannot break the page or smuggle in a link. A
 * paragraph is an array of parts: a string is plain text, `{ b: 'text' }` is
 * bold text.
 *
 * The layout is light, table-based and inline-styled — what mail clients
 * actually render. Dark-mode clients invert it on their own.
 */

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Only http(s) links go in a button; anything else is dropped. */
function safeUrl(url) {
  const s = String(url || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

// A line break inside a paragraph (an organiser's announcement) stays one.
const partsToHtml = (parts) =>
  (Array.isArray(parts) ? parts : [parts])
    .map((p) => (p && typeof p === 'object' && 'b' in p ? `<strong style="color:#111111;">${esc(p.b)}</strong>` : esc(p)))
    .join('')
    .replace(/\r?\n/g, '<br>');

const partsToText = (parts) =>
  (Array.isArray(parts) ? parts : [parts]).map((p) => (p && typeof p === 'object' && 'b' in p ? p.b : p)).join('');

/**
 * @param {{
 *   preheader?: string,       inbox preview line
 *   eyebrow?: string,         small label above the heading (event name)
 *   heading: string,
 *   paragraphs?: Array<Array<string|{b:string}>|string>,
 *   cta?: { label: string, url: string },
 *   note?: string,            small print under the button
 *   lang?: 'en'|'az'|'ru',    language of the layout's own words (default en)
 * }} c
 * @returns {{ html: string, text: string }}
 */
/** The layout's own words, in the languages events run in. */
const CHROME = {
  en: { fallback: 'If the button does not work, paste this link into your browser:', tagline: 'Hackathon operations platform' },
  az: { fallback: 'Düymə işləməsə, bu linki brauzerə yapışdırın:', tagline: 'Hakaton idarəetmə platforması' },
  ru: { fallback: 'Если кнопка не работает, вставьте эту ссылку в браузер:', tagline: 'Платформа для проведения хакатонов' },
};

function renderEmail(c) {
  const year = new Date().getFullYear();
  const lang = CHROME[c.lang] ? c.lang : 'en';
  const words = CHROME[lang];
  const url = safeUrl(c.cta?.url);
  const paragraphs = c.paragraphs || [];

  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46;">${partsToHtml(p)}</p>`)
    .join('\n');

  const button = url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:10px;background:#E1003C;">
<a href="${esc(url)}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(c.cta.label)}</a>
</td></tr></table>
<p style="margin:0 0 20px;font-size:12px;line-height:1.5;color:#71717a;">${esc(words.fallback)}<br><a href="${esc(url)}" style="color:#E1003C;word-break:break-all;">${esc(url)}</a></p>`
    : '';

  const note = c.note
    ? `<p style="margin:0;font-size:12px;line-height:1.6;color:#71717a;">${esc(c.note)}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(c.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(c.preheader || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 4px 16px;font-size:16px;font-weight:700;letter-spacing:-0.01em;color:#111111;">Hack<span style="color:#E1003C;">OS</span></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e4e4e7;border-radius:14px;padding:32px;">
${c.eyebrow ? `<p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#E1003C;">${esc(c.eyebrow)}</p>` : ''}
<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:700;color:#111111;">${esc(c.heading)}</h1>
${body}
${button}
${note}
</td></tr>
<tr><td style="padding:16px 4px 0;font-size:12px;line-height:1.6;color:#a1a1aa;">© ${year} HackOS · ${esc(words.tagline)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    c.eyebrow ? c.eyebrow.toUpperCase() : null,
    c.heading,
    '',
    ...paragraphs.map((p) => `${partsToText(p)}\n`),
    url ? `${c.cta.label}: ${url}\n` : null,
    c.note || null,
    '',
    `© ${year} HackOS`,
  ]
    .filter((l) => l !== null)
    .join('\n');

  return { html, text };
}

module.exports = { renderEmail, esc, safeUrl };
