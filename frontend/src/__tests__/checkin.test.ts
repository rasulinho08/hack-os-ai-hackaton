/**
 * Check-in at the door: what reaches the scanner is read as the API reads
 * it, a ticket's QR code leads to the scanner with the event and the code,
 * the API's answers are read defensively, a refusal maps to its sentence,
 * organisers who follow a ticket's QR code get their own scanner, only the
 * scanners may use the camera, and the walkthrough's list behaves like the
 * real one.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api";
import en from "@/lib/i18n/checkin/en";
import {
  CHECKIN_ERROR_CODES, CODE_ALPHABET, CODE_LENGTH, ORGANISER_SCAN_PATH, VOLUNTEER_SCAN_PATH, checkinErrorKey, formatCode,
  normalizeList, normalizePerson, normalizeScan, normalizeStats, normalizeTicket, parseScanInput, ticketFromSearch, ticketQrValue,
} from "@/lib/checkin";
import { redirectIfWrongRoleZone } from "@/lib/roleRedirects";
import { CAMERA_PAGES, baseHeaders, permissionsPolicy, securityHeaders } from "@/lib/securityHeaders";
import { resolveDemoRead } from "@/lib/demo/resolve";

describe("parseScanInput", () => {
  it("reads a typed code however it was typed", () => {
    expect(parseScanInput("ABCD2345")).toEqual({ code: "ABCD2345", eventId: null });
    expect(parseScanInput("  abcd-2345 ")).toEqual({ code: "ABCD2345", eventId: null });
    expect(parseScanInput("abcd 2345")).toEqual({ code: "ABCD2345", eventId: null });
  });

  it("reads a ticket's whole QR address, with its event", () => {
    expect(parseScanInput("https://app.hack-os.app/volunteer/scan?e=12&c=QRST6789")).toEqual({ code: "QRST6789", eventId: 12 });
    expect(parseScanInput("http://localhost:3001/volunteer/scan?c=qrst-6789&e=7#x")).toEqual({ code: "QRST6789", eventId: 7 });
    expect(parseScanInput("e=5&c=QRST6789")).toEqual({ code: "QRST6789", eventId: 5 });
    expect(parseScanInput("?e=0&c=QRST6789")).toEqual({ code: "QRST6789", eventId: null });
  });

  it("refuses what is not a ticket code", () => {
    expect(parseScanInput("")).toEqual({ code: null, eventId: null });
    expect(parseScanInput("hello")).toEqual({ code: null, eventId: null });
    // 0, O, 1 and I are not in the alphabet: they are misread for each other.
    expect(parseScanInput("ABCD0123").code).toBeNull();
    expect(parseScanInput("ABCDOIJK").code).toBeNull();
    expect(parseScanInput("ABCD23456").code).toBeNull();
    expect(parseScanInput("https://example.com/menu").code).toBeNull();
  });

  it("uses the same alphabet as the API", () => {
    expect(CODE_ALPHABET).toBe("23456789ABCDEFGHJKLMNPQRSTUVWXYZ");
    expect(CODE_LENGTH).toBe(8);
    for (const ch of "01OI") expect(CODE_ALPHABET).not.toContain(ch);
  });
});

describe("formatCode / ticketQrValue / ticketFromSearch", () => {
  it("splits a code in two for reading aloud", () => {
    expect(formatCode("ABCD2345")).toBe("ABCD-2345");
    expect(formatCode("ABC")).toBe("ABC");
    expect(formatCode(null)).toBe("");
  });

  it("points the QR code at the volunteers' scanner with the event and the code", () => {
    const value = ticketQrValue(12, "QRST6789", "https://app.hack-os.app");
    expect(value.startsWith("http")).toBe(true);
    expect(value).toContain(`${VOLUNTEER_SCAN_PATH}?e=12&c=QRST6789`);
    // What the camera reads from it is the ticket again.
    expect(parseScanInput(value)).toEqual({ code: "QRST6789", eventId: 12 });
    expect(ORGANISER_SCAN_PATH).toBe("/checkin/scan");
  });

  it("finds the ticket a QR code opened the scanner with", () => {
    expect(ticketFromSearch("?e=12&c=QRST6789")).toEqual({ text: "?e=12&c=QRST6789", eventId: 12 });
    expect(ticketFromSearch("c=QRST6789")).toEqual({ text: "QRST6789", eventId: null });
    expect(ticketFromSearch("?e=x&c=QRST6789")).toEqual({ text: "QRST6789", eventId: null });
    expect(ticketFromSearch("?e=12")).toBeNull();
    expect(ticketFromSearch("")).toBeNull();
    expect(parseScanInput(ticketFromSearch("?e=12&c=qrst-6789")!.text)).toEqual({ code: "QRST6789", eventId: 12 });
  });
});

describe("normalizers", () => {
  const person = {
    participantId: 41, name: "Aysel M", email: "a@x.az", team: "Nova", status: "approved", checkedIn: true,
    checkedInAt: "2026-08-28T05:10:00.000Z", checkedInBy: { id: 9, name: "Staff" }, method: "qr", code: "QRST6789",
  };

  it("keeps a person with an id and defaults the rest", () => {
    expect(normalizePerson(person)).toEqual(person);
    expect(normalizePerson({ participantId: 3 })).toEqual({
      participantId: 3, name: null, team: null, status: "", checkedIn: false, checkedInAt: null, checkedInBy: null, method: null,
    });
    expect(normalizePerson({ participantId: 3, method: "teleport" })!.method).toBeNull();
    expect(normalizePerson({ participantId: 0 })).toBeNull();
    expect(normalizePerson(null)).toBeNull();
  });

  it("reads a ticket only with its code and event", () => {
    expect(normalizeTicket({ ...person, eventId: 12, eventName: "Baku AI" })).toMatchObject({ eventId: 12, eventName: "Baku AI", code: "QRST6789" });
    expect(normalizeTicket({ ...person, code: null, eventId: 12 })).toBeNull();
    expect(normalizeTicket({ ...person, eventId: "x" })).toBeNull();
  });

  it("reads counts, lists and scan results", () => {
    expect(normalizeStats({ admitted: "10", checkedIn: 4, remaining: 6, canManage: true })).toEqual({ admitted: 10, checkedIn: 4, remaining: 6, canManage: true });
    expect(normalizeStats(null)).toEqual({ admitted: 0, checkedIn: 0, remaining: 0, canManage: false });
    const list = normalizeList({ stats: { admitted: 2, checkedIn: 1, remaining: 1 }, total: 2, limit: 50, offset: 0, items: [person, { nope: 1 }] });
    expect(list.items).toHaveLength(1);
    expect(list.stats.canManage).toBe(false);
    expect(normalizeList({}).limit).toBe(50);
    expect(normalizeScan({ result: "already", participant: person })!.result).toBe("already");
    expect(normalizeScan({ result: "undone", participant: person })).toBeNull();
    expect(normalizeScan({ result: "checked_in" })).toBeNull();
  });
});

describe("checkinErrorKey", () => {
  it("names a sentence for every refusal the API sends", () => {
    for (const code of CHECKIN_ERROR_CODES) {
      const key = code === "generic" ? checkinErrorKey(new Error("x")) : checkinErrorKey(new ApiError("x", 400, [], code));
      expect(key).toBe(`ci.err.${code}`);
      expect(en[key], key).toBeTruthy();
    }
  });

  it("falls back on the status, then on a general sentence", () => {
    expect(checkinErrorKey(new ApiError("x", 403))).toBe("ci.err.FORBIDDEN");
    expect(checkinErrorKey(new ApiError("x", 404))).toBe("ci.err.NOT_FOUND");
    expect(checkinErrorKey(new ApiError("x", 429))).toBe("ci.err.RATE_LIMITED");
    expect(checkinErrorKey(new ApiError("x", 500, [], "SOMETHING_ELSE"))).toBe("ci.err.generic");
  });
});

describe("a ticket's QR code opened by an organiser", () => {
  const req = (url: string) => new NextRequest(url);

  it("leads to the organisers' scanner with the ticket", () => {
    const res = redirectIfWrongRoleZone("admin", "/volunteer/scan", req("http://app.localhost:3001/volunteer/scan?e=12&c=QRST6789"));
    expect(res?.status).toBe(307);
    const to = new URL(res!.headers.get("location")!);
    expect(to.pathname).toBe("/checkin/scan");
    expect(to.searchParams.get("e")).toBe("12");
    expect(to.searchParams.get("c")).toBe("QRST6789");
  });

  it("leaves volunteers on theirs, and organisers' other volunteer pages alone", () => {
    expect(redirectIfWrongRoleZone("volunteer", "/volunteer/scan", req("http://app.localhost:3001/volunteer/scan?c=QRST6789"))).toBeNull();
    expect(redirectIfWrongRoleZone("admin", "/volunteer/tasks", req("http://app.localhost:3001/volunteer/tasks"))).toBeNull();
    // A participant who scans a ticket goes home, not to a scanner.
    const res = redirectIfWrongRoleZone("hacker", "/volunteer/scan", req("http://app.localhost:3001/volunteer/scan?c=QRST6789"));
    expect(new URL(res!.headers.get("location")!).pathname).toBe("/hacker");
  });
});

describe("the camera", () => {
  const header = (list: { key: string; value: string }[], key: string) => list.find((h) => h.key === key)?.value;

  it("is off on every page and API answer", () => {
    expect(header(securityHeaders(), "Permissions-Policy")).toContain("camera=()");
    expect(header(baseHeaders(), "Permissions-Policy")).toContain("camera=()");
    expect(permissionsPolicy()).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  });

  it("is allowed for the site itself on the two scanners only, nothing else loosened", () => {
    expect(CAMERA_PAGES).toEqual(["/checkin/scan", "/volunteer/scan"]);
    expect(permissionsPolicy({ camera: true })).toBe("camera=(self), microphone=(), geolocation=(), payment=(), usb=()");
  });
});

describe("the walkthrough", () => {
  it("answers the list with its search, filter and pages", () => {
    const all = resolveDemoRead("/api/events/1/checkin?limit=50") as { stats: { admitted: number; checkedIn: number; remaining: number }; total: number; items: { checkedIn: boolean; code: string; name: string; checkedInAt: string | null }[] };
    expect(all.stats.admitted).toBeGreaterThan(50);
    expect(all.stats.checkedIn + all.stats.remaining).toBe(all.stats.admitted);
    expect(all.total).toBe(all.stats.admitted);
    expect(all.items).toHaveLength(50);
    for (const r of all.items) expect(parseScanInput(r.code).code).toBe(r.code);
    // Latest arrivals first.
    const times = all.items.map((r) => r.checkedInAt).filter(Boolean) as string[];
    expect([...times].sort().reverse()).toEqual(times);

    const out = resolveDemoRead("/api/events/1/checkin?filter=out") as typeof all;
    expect(out.total).toBe(all.stats.remaining);
    expect(out.items.every((r) => !r.checkedIn)).toBe(true);

    const one = all.items[3];
    const found = resolveDemoRead(`/api/events/1/checkin?q=${encodeURIComponent(one.code.toLowerCase())}`) as typeof all;
    expect(found.items.map((r) => r.code)).toContain(one.code);

    const page2 = resolveDemoRead("/api/events/1/checkin?limit=50&offset=50") as typeof all;
    expect(page2.items[0].name).not.toBe(all.items[0].name);
  });

  it("answers the scanner's counts, and nothing it does not know", () => {
    expect(resolveDemoRead("/api/events/1/checkin/stats")).toMatchObject({ canManage: true });
    expect(resolveDemoRead("/api/events/1/checkin/me")).toBeUndefined();
    expect(resolveDemoRead("/api/events/2/checkin")).toBeUndefined();
  });
});
