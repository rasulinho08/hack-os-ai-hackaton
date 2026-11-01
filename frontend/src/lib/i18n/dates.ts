/**
 * Dates and relative times in the reader's language.
 *
 * Chrome and the other Chromium browsers ship ICU without Azerbaijani names:
 * there Intl writes "22 okt" as "M10 22" and "in 3 days" as "+3 d" (Firefox,
 * Safari and Node are fine, so tests never saw it). Azerbaijani is therefore
 * put together here from the numbers Intl gives in any locale and the names
 * below; English and Russian go through Intl as they are.
 */

import type { Lang } from "./types";

const LOCALE: Record<string, string> = { en: "en-GB", ru: "ru-RU", az: "az-Latn-AZ" };

export const AZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"];
export const AZ_MONTHS_SHORT = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avq", "sen", "okt", "noy", "dek"];
/** Sunday first, as Date.getDay() counts. */
export const AZ_WEEKDAYS = ["bazar", "bazar ertəsi", "çərşənbə axşamı", "çərşənbə", "cümə axşamı", "cümə", "şənbə"];
export const AZ_WEEKDAYS_SHORT = ["B.", "B.e.", "Ç.a.", "Ç.", "C.a.", "C.", "Ş."];

const EN_WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number | string) => String(n).padStart(2, "0");

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The components a dateStyle / timeStyle stands for, so Azerbaijani can follow them. */
function expandStyles(o: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  if (!o.dateStyle && !o.timeStyle) return o;
  const out: Intl.DateTimeFormatOptions = { timeZone: o.timeZone };
  if (o.dateStyle === "full") Object.assign(out, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  else if (o.dateStyle === "long") Object.assign(out, { day: "numeric", month: "long", year: "numeric" });
  else if (o.dateStyle === "medium") Object.assign(out, { day: "numeric", month: "short", year: "numeric" });
  else if (o.dateStyle === "short") Object.assign(out, { day: "2-digit", month: "2-digit", year: "numeric" });
  if (o.timeStyle) Object.assign(out, { hour: "2-digit", minute: "2-digit", ...(o.timeStyle === "short" ? {} : { second: "2-digit" }) });
  return out;
}

function azDate(d: Date, options: Intl.DateTimeFormatOptions): string {
  const o = expandStyles(options);
  const has = (k: keyof Intl.DateTimeFormatOptions) => o[k] !== undefined;
  const any = (["weekday", "year", "month", "day", "hour", "minute", "second"] as const).some(has);
  const opts: Intl.DateTimeFormatOptions = any ? o : { ...o, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };
  const want = (k: keyof Intl.DateTimeFormatOptions) => opts[k] !== undefined;

  const base: Intl.DateTimeFormatOptions = {
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23", weekday: "short", ...(opts.timeZoneName ? { timeZoneName: opts.timeZoneName } : {}),
  };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { ...base, timeZone: opts.timeZone }).formatToParts(d);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", base).formatToParts(d);
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const day = Number(get("day"));
  const month = Number(get("month"));
  const year = get("year");
  const hour = pad(Number(get("hour")) % 24);
  const weekday = EN_WEEKDAY.indexOf(get("weekday"));

  let date = "";
  const y = opts.year === "2-digit" ? year.slice(-2) : year;
  if (opts.month === "numeric" || opts.month === "2-digit") {
    date = [want("day") ? pad(day) : null, pad(month), want("year") ? y : null].filter(Boolean).join(".");
  } else if (want("month")) {
    const name = opts.month === "long" ? AZ_MONTHS[month - 1] : AZ_MONTHS_SHORT[month - 1];
    date = [want("day") ? String(day) : null, name, want("year") ? y : null].filter(Boolean).join(" ");
  } else {
    date = [want("day") ? String(day) : null, want("year") ? y : null].filter(Boolean).join(".");
  }
  if (want("weekday") && weekday >= 0) {
    const wd = opts.weekday === "long" ? AZ_WEEKDAYS[weekday] : AZ_WEEKDAYS_SHORT[weekday];
    date = date ? `${wd}, ${date}` : wd;
  }

  let time = "";
  if (want("hour") || want("minute")) {
    time = want("minute") || !want("hour") ? `${hour}:${get("minute")}` : hour;
    if (want("second")) time += `:${get("second")}`;
  }
  const zone = opts.timeZoneName ? get("timeZoneName") : "";
  return [[date, time].filter(Boolean).join(", "), zone].filter(Boolean).join(" ");
}

/**
 * One date (and/or time) in the reader's language — Intl's options, Intl's
 * meaning. "" for nothing or something that is not a date.
 */
export function formatDate(value: DateInput, lang: Lang | string, options: Intl.DateTimeFormatOptions = {}): string {
  const d = toDate(value);
  if (!d) return "";
  if (lang === "az") return azDate(d, options);
  try {
    return new Intl.DateTimeFormat(LOCALE[lang] || "en-GB", options).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

export type RelativeUnit = "second" | "minute" | "hour" | "day";

const AZ_UNIT: Record<RelativeUnit, string> = { second: "saniyə", minute: "dəqiqə", hour: "saat", day: "gün" };
const AZ_NOW: Record<RelativeUnit, string> = { second: "indi", minute: "bu dəqiqə", hour: "bu saat", day: "bu gün" };

/** "in 3 hours", "5 minutes ago", "tomorrow" — `n` is signed (future positive). */
export function formatRelativeUnit(n: number, unit: RelativeUnit, lang: Lang | string): string {
  if (lang === "az") {
    if (n === 0) return AZ_NOW[unit];
    if (unit === "day" && n === 1) return "sabah";
    if (unit === "day" && n === -1) return "dünən";
    return `${Math.abs(n)} ${AZ_UNIT[unit]} ${n > 0 ? "sonra" : "əvvəl"}`;
  }
  try {
    return new Intl.RelativeTimeFormat(LOCALE[lang] || "en-GB", { numeric: "auto" }).format(n, unit);
  } catch {
    return `${n} ${unit}`;
  }
}

/**
 * How long ago (or how far ahead) a moment is, in the largest whole unit:
 * days, then hours, minutes, seconds.
 */
export function formatRelative(value: DateInput, lang: Lang | string, now = Date.now()): string {
  const d = toDate(value);
  if (!d) return "";
  const diff = d.getTime() - now;
  const days = Math.round(diff / 86400e3);
  const hours = Math.round(diff / 3600e3);
  const minutes = Math.round(diff / 60e3);
  const seconds = Math.round(diff / 1000);
  if (Math.abs(days) >= 1) return formatRelativeUnit(days, "day", lang);
  if (Math.abs(hours) >= 1) return formatRelativeUnit(hours, "hour", lang);
  if (Math.abs(minutes) >= 1) return formatRelativeUnit(minutes, "minute", lang);
  if (Math.abs(seconds) < 45) return formatRelativeUnit(lang === "az" ? 0 : seconds, "second", lang);
  return formatRelativeUnit(minutes, "minute", lang);
}
