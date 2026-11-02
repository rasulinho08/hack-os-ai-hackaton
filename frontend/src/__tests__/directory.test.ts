/**
 * The hackathon directory's helpers: reading the API's answer (and refusing
 * what a page must not follow), the query in the address, the words on a
 * card, the schema.org markup, and the page's copy in three languages.
 */
import { describe, expect, it } from "vitest";
import {
  directoryJsonLd, directorySearch, eventDates, isFiltered, jsonForScript, localDay, normalizeDirectory, normalizeEvent,
  parseDirectoryQuery, placeOf, statusOf, teamSizeText, type DirectoryEvent,
} from "@/lib/directory";
import { DIRECTORY_COPY, countText, directoryCopy } from "@/app/(site)/hackathons/copy";

const RAW = {
  slug: "caspian-ai-2026",
  url: "/e/caspian-ai-2026",
  name: "Caspian AI Hackathon",
  tagline: "48 hours",
  category: "hackathon",
  language: "az",
  organiser: { name: "Caspian Tech University", logoUrl: "javascript:alert(1)" },
  startDate: "2026-10-17T20:30:00.000Z",
  endDate: "2026-10-19T14:00:00.000Z",
  timezone: "Asia/Baku",
  phase: "open",
  registration: { opensAt: null, closesAt: "2026-10-15T19:00:00.000Z", open: true },
  format: "hybrid",
  city: "Bakı",
  country: "AZ",
  venue: "B korpusu",
  teamSize: { min: 2, max: 5 },
  mode: "both",
  cover: "/api/files/0f8a2f8e-6d4b-4f4f-9a51-1c1d0f6f2a11",
};

const ev = (over: Partial<DirectoryEvent> = {}): DirectoryEvent => ({ ...(normalizeEvent(RAW) as DirectoryEvent), ...over });

describe("reading the API", () => {
  it("keeps a card's facts", () => {
    const e = normalizeEvent(RAW)!;
    expect(e.slug).toBe("caspian-ai-2026");
    expect(e.url).toBe("/e/caspian-ai-2026");
    expect(e.organiser).toEqual({ name: "Caspian Tech University", logoUrl: null });
    expect(e.cover).toBe(RAW.cover);
    expect(e.teamSize).toEqual({ min: 2, max: 5 });
  });

  it("drops what a page must not follow", () => {
    expect(normalizeEvent({ ...RAW, slug: "../admin" })).toBeNull();
    expect(normalizeEvent({ ...RAW, slug: "UPPER" })).toBeNull();
    expect(normalizeEvent({ ...RAW, name: "" })).toBeNull();
    expect(normalizeEvent({ ...RAW, cover: "http://evil.example/x.png" })!.cover).toBeNull();
    expect(normalizeEvent({ ...RAW, cover: "/api/files/../../etc" })!.cover).toBeNull();
    expect(normalizeEvent({ ...RAW, format: "space", phase: "weird" })!.format).toBe("offline");
  });

  it("reads a page with its facets, and survives nonsense", () => {
    const page = normalizeDirectory({ items: [RAW, { slug: "x y" }], page: 2, limit: 12, total: 30, pages: 3, facets: { phases: { open: 4 }, formats: { online: 2 }, cities: [{ name: "Bakı", count: 3 }, { name: "" }], total: 30 } });
    expect(page.items).toHaveLength(1);
    expect(page.page).toBe(2);
    expect(page.pages).toBe(3);
    expect(page.facets.phases).toEqual({ open: 4, upcoming: 0, running: 0, past: 0 });
    expect(page.facets.cities).toEqual([{ name: "Bakı", count: 3 }]);
    expect(normalizeDirectory(null).items).toEqual([]);
  });
});

describe("the query in the address", () => {
  it("parses and rebuilds it, leaving out what is not set", () => {
    const q = parseDirectoryQuery({ status: "open", format: "HYBRID", city: " Bakı ", q: "  ai   hack ", page: "2" });
    expect(q).toEqual({ status: "open", format: "hybrid", city: "Bakı", q: "ai hack", page: 2 });
    expect(directorySearch(q)).toBe("?status=open&format=hybrid&city=Bak%C4%B1&q=ai+hack&page=2");
    expect(parseDirectoryQuery(new URLSearchParams(directorySearch(q).slice(1)))).toEqual(q);
    expect(directorySearch({ page: 1 })).toBe("");
    expect(isFiltered(parseDirectoryQuery({}))).toBe(false);
  });

  it("drops unknown values and odd pages", () => {
    expect(parseDirectoryQuery({ status: "drafts", format: "space", page: "-3" })).toEqual({ status: null, format: null, city: null, q: null, page: 1 });
    expect(parseDirectoryQuery({ page: "9999" }).page).toBe(500);
    expect(parseDirectoryQuery({ q: "x".repeat(300) }).q).toHaveLength(80);
  });
});

describe("the words on a card", () => {
  const en = DIRECTORY_COPY.en;

  it("dates in the event's own time zone", () => {
    // 20:30 UTC on the 17th is already the 18th in Baku.
    expect(localDay("2026-10-17T20:30:00.000Z", "Asia/Baku")).toBe("2026-10-18");
    expect(eventDates(ev(), "en")).toBe("18–19 October 2026");
    expect(eventDates(ev(), "az")).toBe("18–19 oktyabr 2026");
  });

  it("the status line by phase", () => {
    expect(statusOf(ev(), en.status, "en")).toEqual({ tone: "open", label: "Registration open until 15 October" });
    expect(statusOf(ev(), DIRECTORY_COPY.az.status, "az").label).toBe("Qeydiyyat 15 oktyabr tarixinədək açıqdır");
    expect(statusOf(ev({ registration: { opensAt: null, closesAt: null, open: true } }), en.status, "en").label).toBe("Registration open");
    expect(statusOf(ev({ phase: "running" }), en.status, "en")).toEqual({ tone: "live", label: "Running now" });
    expect(statusOf(ev({ phase: "past" }), en.status, "en")).toEqual({ tone: "done", label: "Finished" });
    const later = new Date(Date.now() + 5 * 864e5).toISOString();
    expect(statusOf(ev({ phase: "upcoming", registration: { opensAt: later, closesAt: null, open: false } }), en.status, "en").label).toMatch(/^Registration opens /);
    expect(statusOf(ev({ phase: "upcoming", registration: { opensAt: null, closesAt: null, open: false } }), en.status, "en").label).toBe("Registration closed");
  });

  it("the place and the team size", () => {
    expect(placeOf(ev(), en.formats)).toBe("Hybrid · Bakı · B korpusu");
    expect(placeOf(ev({ format: "online" }), en.formats)).toBe("Online");
    expect(placeOf(ev({ format: "offline", city: null, venue: null }), en.formats)).toBe("In person");
    expect(teamSizeText(ev(), en.team)).toBe("Teams of 2–5");
    expect(teamSizeText(ev({ teamSize: { min: 1, max: 4 } }), en.team)).toBe("Solo or teams up to 4");
    expect(teamSizeText(ev({ teamSize: { min: 3, max: 3 } }), en.team)).toBe("Teams of 3");
    expect(teamSizeText(ev({ teamSize: { min: 1, max: null } }), en.team)).toBe("Any team size");
  });
});

describe("schema.org markup", () => {
  it("describes each event, with absolute links and the attendance mode", () => {
    const ld = directoryJsonLd([ev(), ev({ slug: "online-one", url: "/e/online-one", format: "online", cover: null })], "https://www.hack-os.app", "/hackathons");
    expect(ld["@type"]).toBe("ItemList");
    expect(ld.numberOfItems).toBe(2);
    const [a, b] = ld.itemListElement.map((x) => x.item as Record<string, unknown>);
    expect(a["@type"]).toBe("Event");
    expect(a.url).toBe("https://www.hack-os.app/e/caspian-ai-2026");
    expect(a.eventAttendanceMode).toBe("https://schema.org/MixedEventAttendanceMode");
    expect(a.organizer).toEqual({ "@type": "Organization", name: "Caspian Tech University" });
    expect(a.image).toEqual([`https://www.hack-os.app${RAW.cover}`]);
    expect(b.location).toEqual({ "@type": "VirtualLocation", url: "https://www.hack-os.app/e/online-one" });
    expect(JSON.stringify(ld)).not.toMatch(/email|phone|participant/i);
  });

  it("cannot close its script tag", () => {
    const out = jsonForScript({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });
});

describe("the page's copy", () => {
  const leaves = (v: unknown, path = ""): [string, unknown][] =>
    v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => leaves(x, path ? `${path}.${k}` : k)) : [[path, v]];
  const slots = (s: string) => (s.match(/\{[a-z]+\}/gi) || []).sort().join(",");

  it("has the same keys and {slots} in every language, nothing empty", () => {
    const en = new Map(leaves(DIRECTORY_COPY.en));
    for (const l of ["az", "ru"] as const) {
      const other = new Map(leaves(DIRECTORY_COPY[l]));
      expect([...other.keys()].sort()).toEqual([...en.keys()].sort());
      for (const [p, v] of en) {
        expect(slots(String(other.get(p))), `${l}:${p}`).toBe(slots(String(v)));
        expect(String(other.get(p)).trim(), `${l}:${p}`).not.toBe("");
      }
    }
  });

  it("falls back to English and counts", () => {
    expect(directoryCopy("de")).toBe(DIRECTORY_COPY.en);
    expect(countText(DIRECTORY_COPY.en, 1)).toBe("1 hackathon");
    expect(countText(DIRECTORY_COPY.en, 12)).toBe("12 hackathons");
    expect(countText(DIRECTORY_COPY.ru, 5)).toBe("Хакатонов: 5");
  });
});
