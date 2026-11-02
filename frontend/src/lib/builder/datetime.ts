/**
 * Dates in the event's own time zone.
 *
 * An organiser in Baku setting up an event in Berlin types Berlin wall-clock
 * times, and a participant anywhere reads them as the event's local time
 * with the zone named. The browser's own zone plays no part.
 */
import { formatDate } from "@/lib/i18n/dates";

function partsIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const p: Record<string, number> = {};
  for (const x of parts) if (x.type !== "literal") p[x.type] = Number(x.value);
  return p;
}

/** Milliseconds the zone is ahead of UTC at `date`. */
export function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO instant → "YYYY-MM-DDTHH:mm" on the zone's wall clock (for <input type="datetime-local">). */
export function toZonedInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = partsIn(d, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour % 24)}:${pad(p.minute)}`;
}

/** "YYYY-MM-DDTHH:mm" read as the zone's wall clock → ISO instant. */
export function fromZonedInput(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || "");
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const first = zoneOffsetMs(new Date(guess), timeZone);
  let ts = guess - first;
  const second = zoneOffsetMs(new Date(ts), timeZone);
  if (second !== first) ts = guess - second;
  return new Date(ts).toISOString();
}

/** "17 Nov 2026, 10:00" in the event's zone (Azerbaijani names even in Chrome — see i18n/dates). */
export function formatInZone(iso: string | null | undefined, timeZone: string, lang: string, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const options: Intl.DateTimeFormatOptions = {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...opts,
  };
  const out = formatDate(d, lang, options);
  // An unknown zone name: the same moment in the browser's own zone.
  return out || formatDate(d, lang, { ...options, timeZone: undefined });
}

/** "GMT+4" for the zone at that moment. */
export function zoneLabel(timeZone: string, at: Date = new Date()): string {
  const off = Math.round(zoneOffsetMs(at, timeZone) / 60000);
  const sign = off >= 0 ? "+" : "-";
  const h = Math.floor(Math.abs(off) / 60);
  const min = Math.abs(off) % 60;
  return `GMT${sign}${h}${min ? `:${pad(min)}` : ""}`;
}

/** Every zone the browser knows, Baku first. */
export function timeZones(): string[] {
  let list: string[] = [];
  try {
    list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") || [];
  } catch {
    list = [];
  }
  if (!list.length) list = ["Asia/Baku", "Europe/Istanbul", "Europe/London", "Europe/Berlin", "Europe/Moscow", "America/New_York", "UTC"];
  return ["Asia/Baku", ...list.filter((z) => z !== "Asia/Baku")];
}
