/**
 * Dates in the reader's language. Azerbaijani is put together by hand,
 * because Chrome's Intl has no Azerbaijani names ("M10 22", "+3 d"); English
 * and Russian go through Intl. Node has full ICU, so these tests check the
 * hand-made Azerbaijani against what a reader expects, not against Intl.
 */
import { describe, expect, it } from "vitest";
import { formatDate, formatRelative, formatRelativeUnit } from "@/lib/i18n/dates";
import { formatInZone } from "@/lib/builder/datetime";

const AT = "2026-10-22T03:24:05.000Z"; // Thursday; 07:24 in Baku

describe("formatDate", () => {
  it("writes Azerbaijani dates with Azerbaijani names, in the asked zone", () => {
    const tz = "Asia/Baku";
    expect(formatDate(AT, "az", { timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })).toBe("22 okt 2026, 07:24");
    expect(formatDate(AT, "az", { timeZone: tz, day: "numeric", month: "long" })).toBe("22 oktyabr");
    expect(formatDate(AT, "az", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" })).toBe("cümə axşamı, 22 oktyabr 2026");
    expect(formatDate(AT, "az", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" })).toBe("22.10.2026");
    expect(formatDate(AT, "az", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit" })).toBe("07:24:05");
    expect(formatDate(AT, "az", { timeZone: tz, dateStyle: "medium", timeStyle: "short" })).toBe("22 okt 2026, 07:24");
    expect(formatDate(AT, "az", { timeZone: tz })).toBe("22.10.2026, 07:24");
    expect(formatDate(AT, "az", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })).toBe("22 okt, 03:24");
    expect(formatDate("2026-01-05T20:30:00Z", "az", { timeZone: "Asia/Baku", day: "numeric", month: "short" })).toBe("6 yan");
  });

  it("leaves English and Russian to Intl, and says nothing for no date", () => {
    expect(formatDate(AT, "en", { timeZone: "Asia/Baku", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })).toBe("22 Oct, 07:24");
    expect(formatDate(AT, "ru", { timeZone: "Asia/Baku", day: "numeric", month: "short" })).toMatch(/^22 окт/);
    expect(formatDate(null, "az")).toBe("");
    expect(formatDate("not a date", "en")).toBe("");
  });

  it("the event-zone formatter uses it, dropping the year when asked", () => {
    expect(formatInZone(AT, "Asia/Baku", "az", { year: undefined })).toBe("22 okt, 07:24");
    expect(formatInZone(AT, "Asia/Baku", "az")).toBe("22 okt 2026, 07:24");
    expect(formatInZone(AT, "Europe/Berlin", "en", { year: undefined })).toBe("22 Oct, 05:24");
  });
});

describe("relative times", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  it("say ahead and ago in Azerbaijani", () => {
    expect(formatRelativeUnit(3, "day", "az")).toBe("3 gün sonra");
    expect(formatRelativeUnit(-5, "minute", "az")).toBe("5 dəqiqə əvvəl");
    expect(formatRelativeUnit(1, "day", "az")).toBe("sabah");
    expect(formatRelativeUnit(-1, "day", "az")).toBe("dünən");
    expect(formatRelativeUnit(0, "minute", "az")).toBe("bu dəqiqə");
    expect(formatRelative(new Date(now - 2 * 3600e3), "az", now)).toBe("2 saat əvvəl");
    expect(formatRelative(new Date(now - 10e3), "az", now)).toBe("indi");
  });

  it("go through Intl in English and Russian", () => {
    expect(formatRelative(new Date(now + 3 * 86400e3), "en", now)).toBe("in 3 days");
    expect(formatRelative(new Date(now - 5 * 60e3), "ru", now)).toBe("5 минут назад");
    expect(formatRelative("", "en", now)).toBe("");
  });
});
