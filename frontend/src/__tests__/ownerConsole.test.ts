/**
 * The owner console's pure helpers: money in minor units, the language a
 * notice is read in and when it shows, the query an audit filter becomes,
 * the sign-up chart's summary and the health verdict.
 */
import { describe, expect, it } from "vitest";
import {
  actionChoices,
  auditCsvUrl,
  auditFiltersFromSearch,
  auditQuery,
  auditSearchString,
  dayLabel,
  formatDuration,
  formatMinor,
  fromLocalInput,
  healthVerdict,
  metaSummary,
  minorDigits,
  noticeState,
  noticeText,
  parsePublicNotice,
  requestSeries,
  signupSummary,
  toLocalInput,
  type OwnerHealth,
} from "@/lib/superadmin/owner";

describe("money", () => {
  it("knows how many minor units a currency has", () => {
    expect(minorDigits("AZN")).toBe(2);
    expect(minorDigits("USD")).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
    expect(minorDigits("KWD")).toBe(3);
  });

  // Intl keeps the code and the amount together with a no-break space.
  const plain = (s: string) => s.replace(/\u00a0/g, " ");

  it("formats minor units with the currency code", () => {
    expect(plain(formatMinor(123456, "AZN"))).toBe("AZN 1,234.56");
    expect(plain(formatMinor(0, "USD"))).toBe("USD 0.00");
    expect(plain(formatMinor(5000, "JPY"))).toBe("JPY 5,000");
    expect(plain(formatMinor(1234, "KWD"))).toBe("KWD 1.234");
  });

  it("never throws on a code Intl does not know", () => {
    expect(formatMinor(150, "XXZ")).toMatch(/1\.50/);
  });
});

describe("the notice", () => {
  const message = { az: "Bu gecə texniki iş.", en: "Maintenance tonight.", ru: "Сегодня работы." };

  it("is read in the reader's language, then English, Azerbaijani, Russian", () => {
    expect(noticeText(message, "az")).toBe("Bu gecə texniki iş.");
    expect(noticeText(message, "ru")).toBe("Сегодня работы.");
    expect(noticeText({ az: "Yalnız AZ", ru: "Только RU" }, "en")).toBe("Yalnız AZ");
    expect(noticeText({ ru: "Только RU" }, "az")).toBe("Только RU");
    expect(noticeText({ en: "  ", ru: " Только " }, "en")).toBe("Только");
    expect(noticeText({}, "en")).toBeNull();
    expect(noticeText(null, "en")).toBeNull();
  });

  it("shows inside its window only", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    expect(noticeState(null, now)).toBe("off");
    expect(noticeState({ active: false, startsAt: null, endsAt: null }, now)).toBe("off");
    expect(noticeState({ active: true, startsAt: null, endsAt: null }, now)).toBe("live");
    expect(noticeState({ active: true, startsAt: "2026-10-19T13:00:00Z", endsAt: null }, now)).toBe("scheduled");
    expect(noticeState({ active: true, startsAt: null, endsAt: "2026-10-19T12:00:00Z" }, now)).toBe("ended");
    expect(noticeState({ active: true, startsAt: "2026-10-19T11:00:00Z", endsAt: "2026-10-19T13:00:00Z" }, now)).toBe("live");
  });

  it("takes only a notice with words from the API", () => {
    expect(parsePublicNotice(null)).toBeNull();
    expect(parsePublicNotice({ level: "warning", message: {} })).toBeNull();
    expect(parsePublicNotice({ level: "loud", message: { en: "x", az: 3 } })).toEqual({
      level: "info", message: { en: "x" }, endsAt: null, updatedAt: null,
    });
    expect(parsePublicNotice({ level: "critical", message: { az: "Vacib" }, endsAt: "2026-10-20T00:00:00Z", updatedAt: "u" })?.level).toBe("critical");
  });

  it("round-trips a date and time through the datetime-local input", () => {
    const iso = "2026-10-19T08:45:00.000Z";
    const local = toLocalInput(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fromLocalInput(local)).toBe(iso);
    expect(toLocalInput(null)).toBe("");
    expect(toLocalInput("garbage")).toBe("");
    expect(fromLocalInput("")).toBeNull();
  });
});

describe("audit filters", () => {
  it("become the API's query, leaving out what is empty or unusable", () => {
    expect(auditQuery({})).toBe("");
    const q = new URLSearchParams(auditQuery({ action: "Chat.", customerId: "4", eventId: " 12 ", actorId: "abc" }, { before: 99, limit: 100 }));
    expect(q.get("action")).toBe("chat.");
    expect(q.get("customerId")).toBe("4");
    expect(q.get("eventId")).toBe("12");
    expect(q.has("actorId")).toBe(false);
    expect(q.get("before")).toBe("99");
    expect(q.get("limit")).toBe("100");
    expect(new URLSearchParams(auditQuery({ action: "bad;drop" })).has("action")).toBe(false);
  });

  it("include the whole last day", () => {
    const q = new URLSearchParams(auditQuery({ from: "2026-10-01", to: "2026-10-19" }));
    const since = new Date(q.get("since") as string);
    const until = new Date(q.get("until") as string);
    expect([since.getFullYear(), since.getMonth(), since.getDate(), since.getHours()]).toEqual([2026, 9, 1, 0]);
    expect([until.getFullYear(), until.getMonth(), until.getDate(), until.getHours()]).toEqual([2026, 9, 20, 0]);
    expect(new URLSearchParams(auditQuery({ from: "19.10.2026" })).has("since")).toBe(false);
  });

  it("export with the same filters", () => {
    const url = auditCsvUrl({ eventId: 7 });
    expect(url.startsWith("/api/owner/audit?")).toBe(true);
    const q = new URLSearchParams(url.split("?")[1]);
    expect(q.get("eventId")).toBe("7");
    expect(q.get("format")).toBe("csv");
    expect(q.has("limit")).toBe(false);
  });

  it("travel in the console's address", () => {
    const f = { action: "owner.", eventId: "12", from: "2026-10-01" };
    const s = auditSearchString(f);
    expect(s).toBe("?action=owner.&eventId=12&from=2026-10-01");
    expect(auditFiltersFromSearch(s)).toEqual(f);
    expect(auditFiltersFromSearch("?nope=1&actorId=")).toEqual({});
    expect(auditSearchString({})).toBe("");
  });

  it("offer families before single actions", () => {
    const choices = actionChoices([
      { action: "chat.mute", n: 2 },
      { action: "chat.unmute", n: 1 },
      { action: "event.archived", n: 5 },
      { action: "login", n: 3 },
    ]);
    expect(choices[0]).toEqual({ value: "chat.", label: "chat.* (all, 3)" });
    expect(choices.map((c) => c.value)).toEqual(["chat.", "chat.mute", "chat.unmute", "event.archived", "login"]);
  });

  it("show an entry's details on one line", () => {
    expect(metaSummary(null)).toBe("");
    expect(metaSummary({})).toBe("");
    expect(metaSummary({ role: "judge", minutes: 10 })).toBe("role: judge · minutes: 10");
    expect(metaSummary({ list: [1, 2] })).toBe("list: [1,2]");
    const long = metaSummary({ text: "x".repeat(300) }, 50);
    expect(long.length).toBe(50);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("sign-ups", () => {
  it("labels calendar days without a time-zone shift", () => {
    expect(dayLabel("2026-10-01")).toBe("1 Oct");
    expect(dayLabel("2026-01-31")).toBe("31 Jan");
    expect(dayLabel("weird")).toBe("weird");
  });

  it("sums the month and finds its busiest day", () => {
    const s = signupSummary([
      { day: "2026-10-17", users: 2, registrations: 0 },
      { day: "2026-10-18", users: 5, registrations: 9 },
      { day: "2026-10-19", users: 1, registrations: 4 },
    ]);
    expect(s.users).toBe(8);
    expect(s.registrations).toBe(13);
    expect(s.busiest).toEqual({ day: "2026-10-18", registrations: 9 });
    expect(s.data[0]).toEqual({ label: "17 Oct", day: "2026-10-17", users: 2, registrations: 0 });
    expect(signupSummary([{ day: "2026-10-19", users: 0, registrations: 0 }]).busiest).toBeNull();
  });
});

describe("health", () => {
  const base: OwnerHealth = {
    checkedAt: "2026-10-19T12:00:00Z",
    version: null,
    environment: "production",
    process: { uptimeS: 3600, node: "v22", rssMb: 120, heapUsedMb: 60 },
    database: { ok: true, error: null, latencyMs: 2.1, pool: { total: 3, idle: 2, waiting: 0 }, migration: null },
    jobs: { counts: { done: 40 }, recentFailures: [], due: 0, lagSeconds: 0, worker: { disabled: false, intervalMs: 15000 } },
    requests: { windowMinutes: 15, requests: 200, serverErrors: 0, clientErrors: 3, errorRate: 0, avgMs: 12, p95Ms: 40, maxMs: 90, series: [], since: "" },
    integrations: {
      mail: { configured: true, provider: "resend", problem: null },
      telegram: { configured: true, webhookReady: true },
      github: { tokenConfigured: false },
      autoArchive: true,
      chat: { crossInstance: true, listenEnabled: true, waiting: 4 },
    },
  };

  it("is green when everything answers", () => {
    expect(healthVerdict(base)).toEqual({ tone: "ok", reasons: [] });
  });

  it("is red when the database is down, amber for what degrades", () => {
    expect(healthVerdict({ ...base, database: { ...base.database, ok: false, error: "ECONNREFUSED" }, jobs: null }).tone).toBe("danger");
    const amber = healthVerdict({
      ...base,
      jobs: { ...base.jobs!, lagSeconds: 600, counts: { failed: 2 } },
      requests: { ...base.requests, errorRate: 12 },
      integrations: { ...base.integrations, mail: { configured: false, provider: null, problem: "RESEND_API_KEY is not set" } },
    });
    expect(amber.tone).toBe("warn");
    expect(amber.reasons).toHaveLength(4);
    expect(amber.reasons.join(" ")).toMatch(/10 min behind/);
  });

  it("does not call an idle instance broken", () => {
    expect(healthVerdict({ ...base, requests: { ...base.requests, requests: 0, errorRate: 0 } }).tone).toBe("ok");
  });

  it("writes durations people read", () => {
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(240)).toBe("4 min");
    expect(formatDuration(3 * 3600 + 20 * 60)).toBe("3 h 20 min");
    expect(formatDuration(7200)).toBe("2 h");
    expect(formatDuration(2 * 86400 + 5 * 3600)).toBe("2 d 5 h");
    expect(formatDuration(-5)).toBe("0 s");
  });

  it("labels the minute series in local time", () => {
    const at = new Date(2026, 9, 19, 9, 5).toISOString();
    expect(requestSeries([{ at, count: 7, errors: 1 }])).toEqual([{ label: "09:05", requests: 7, errors: 1 }]);
  });
});
