/**
 * @file ics.js
 * @description A minimal iCalendar (RFC 5545) writer: VCALENDAR with
 * VEVENTs in UTC, so no time zone blocks are needed. Text is escaped and
 * lines are folded at 75 octets without splitting a UTF-8 character.
 */

const pad = (n) => String(n).padStart(2, '0');

/** 20261019T090000Z */
function stamp(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** TEXT values: backslash, semicolon, comma and new lines escaped. */
function text(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds one content line: CRLF + space every 75 octets, never inside a character. */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Step back to the start of a UTF-8 character.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // the leading space of a continuation line counts
  }
  return parts.join('\r\n ');
}

/**
 * @param {{ name: string, description?: string, events: Array<{
 *   uid: string, start: Date|string, end?: Date|string|null, summary: string,
 *   description?: string, location?: string, url?: string, updated?: Date|string }> }} cal
 * @returns {string}
 */
function calendar({ name, description, events }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HackOS//Event calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${text(name)}`,
  ];
  if (description) lines.push(`X-WR-CALDESC:${text(description)}`);
  const now = stamp(new Date());
  for (const ev of events) {
    const start = stamp(ev.start);
    if (!start) continue;
    let end = ev.end ? stamp(ev.end) : null;
    // A moment (a deadline) is shown as a quarter of an hour.
    if (!end || end <= start) end = stamp(new Date(new Date(ev.start).getTime() + 15 * 60e3));
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.uid}`,
      `DTSTAMP:${stamp(ev.updated) || now}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${text(ev.summary)}`,
    );
    if (ev.description) lines.push(`DESCRIPTION:${text(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${text(ev.location)}`);
    if (ev.url) lines.push(`URL:${String(ev.url).replace(/[\r\n]/g, '')}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

module.exports = { calendar, stamp, text, fold };
