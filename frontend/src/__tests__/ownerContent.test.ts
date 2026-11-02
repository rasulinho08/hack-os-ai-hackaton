/**
 * The owner console's content tools: the story body format (what the editor
 * writes, what the site renders, what stays text), the toolbar, the cover
 * crop arithmetic, the event editor's helpers, and the new site words in
 * AZ, EN and RU.
 */
import { describe, expect, it } from "vitest";
import { applyFormat, imageRef, imagesIn, inlineText, parseBody, parseInline, readingMinutes, safeHref } from "@/lib/storyBody";
import {
  changedFields, cleanSlug, dateRange, directoryLine, formOf, inDirectory, localProblems, looksLikeTest, viewOf, EVENT_VIEWS,
  type OwnerEventPage,
} from "@/lib/superadmin/ownerEvents";
import { focusPosition, normalizeOwnerStory, normalizeStory, storyLangs, storySearchText } from "@/lib/showcase";
import { DIRECTORY_COPY } from "@/app/(site)/hackathons/copy";
import { normalizeEvent } from "@/lib/directory";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("story body", () => {
  it("reads the rich format into blocks", () => {
    const blocks = parseBody(
      [
        "## What happened",
        "First line",
        "second line with **bold** and *italic* and [a link](https://hack-os.app/hackathons).",
        "",
        "- one",
        "- two",
        "",
        "3. third",
        "4. fourth",
        "",
        "> A quote",
        "> on two lines",
        "",
        `![The stage](${ID})`,
        "",
        "---",
        "### Smaller",
      ].join("\n"),
      "rich",
    );
    expect(blocks.map((b) => b.type)).toEqual(["h2", "p", "ul", "ol", "quote", "image", "hr", "h3"]);
    const p = blocks[1] as Extract<(typeof blocks)[number], { type: "p" }>;
    expect(p.lines).toHaveLength(2);
    expect(p.lines[1].map((n) => n.t)).toEqual(["text", "strong", "text", "em", "text", "link", "text"]);
    expect(blocks[3]).toMatchObject({ type: "ol", start: 3 });
    expect(blocks[4]).toMatchObject({ type: "quote" });
    expect((blocks[4] as { lines: unknown[] }).lines).toHaveLength(2);
    expect(blocks[5]).toEqual({ type: "image", ref: ID, caption: "The stage" });
  });

  it("keeps the plain format as it always was: paragraphs and line breaks, no markup", () => {
    const blocks = parseBody("## not a heading\n- not a list\n\n**not bold**", "plain");
    expect(blocks).toEqual([
      { type: "p", lines: [[{ t: "text", v: "## not a heading" }], [{ t: "text", v: "- not a list" }]] },
      { type: "p", lines: [[{ t: "text", v: "**not bold**" }]] },
    ]);
  });

  it("never makes a link of an unsafe address, and never reads HTML", () => {
    expect(parseInline("[click](javascript:alert(1))").every((n) => n.t === "text")).toBe(true);
    expect(parseInline("[x](data:text/html,hi)")).toEqual([{ t: "text", v: "x" }]);
    expect(parseInline("<b>bold</b>")).toEqual([{ t: "text", v: "<b>bold</b>" }]);
    expect(safeHref("/hackathons")).toBe("/hackathons");
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("mailto:hello@hack-os.app")).toBe("mailto:hello@hack-os.app");
    expect(safeHref("https://hack-os.app")).toBe("https://hack-os.app/");
    expect(safeHref("http://localhost")).toBeNull();
  });

  it("finds only story photos as images", () => {
    expect(imageRef(`/api/files/${ID}`)).toBe(ID);
    expect(imageRef("https://example.com/cat.png")).toBeNull();
    expect(parseBody("![x](https://example.com/cat.png)", "rich")).toEqual([]);
    expect(imagesIn(`Text\n\n![a](${ID})\n\n![b](/api/files/${ID.toUpperCase()})`)).toEqual([ID, ID]);
  });

  it("does not take a word with an asterisk or an underscore inside for italics", () => {
    expect(inlineText(parseInline("snake_case_name and 2*3*4"))).toBe("snake_case_name and 2*3*4");
    expect(parseInline("snake_case_name").map((n) => n.t)).toEqual(["text"]);
  });

  it("counts reading time", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes(Array(1000).fill("word").join(" "))).toBe(5);
  });
});

describe("the toolbar", () => {
  it("wraps the selection in bold and italic, and takes it off again", () => {
    const bold = applyFormat({ text: "a word here", start: 2, end: 6 }, "bold");
    expect(bold).toEqual({ text: "a **word** here", start: 4, end: 8 });
    expect(applyFormat(bold, "bold")).toEqual({ text: "a word here", start: 2, end: 6 });
    expect(applyFormat({ text: "", start: 0, end: 0 }, "italic").text).toBe("*italic text*");
  });

  it("makes a link of the selection", () => {
    expect(applyFormat({ text: "see the page", start: 4, end: 12 }, "link", { href: "/hackathons" }).text).toBe("see [the page](/hackathons)");
  });

  it("marks each selected line, numbers lists, and toggles the mark off", () => {
    const text = "one\ntwo\nthree";
    const ul = applyFormat({ text, start: 0, end: text.length }, "ul");
    expect(ul.text).toBe("- one\n- two\n- three");
    expect(applyFormat(ul, "ul").text).toBe(text);
    expect(applyFormat({ text, start: 0, end: text.length }, "ol").text).toBe("1. one\n2. two\n3. three");
    expect(applyFormat({ text: "- item", start: 2, end: 2 }, "h2").text).toBe("## item");
    expect(applyFormat({ text: "Title\nbody", start: 1, end: 1 }, "quote").text).toBe("> Title\nbody");
  });

  it("puts a divider or a photo on a line of its own", () => {
    expect(applyFormat({ text: "before after", start: 6, end: 6 }, "hr").text).toBe("before\n\n---\n\nafter");
    const img = applyFormat({ text: "Intro", start: 5, end: 5 }, "image", { ref: ID, caption: "The [stage]" });
    expect(img.text).toBe(`Intro\n\n![The stage](${ID})\n`);
    expect(parseBody(img.text, "rich")[1]).toEqual({ type: "image", ref: ID, caption: "The stage" });
  });
});

const page = (over: Partial<OwnerEventPage> = {}): OwnerEventPage => ({
  id: 7, event_code: "BAKU", name: "Baku AI", slug: "baku-ai", tagline: null, description: null,
  start_date: "2026-11-19T06:00:00.000Z", end_date: "2026-11-21T06:00:00.000Z", timezone: "Asia/Baku", format: "offline",
  venue_name: null, venue_address: null, city: "Baku", country: null, map_url: null,
  logo_file_id: null, logo_url: null, banner_file_id: null, banner_url: null,
  registration_start: null, registration_end: "2026-11-17T19:59:00.000Z", max_participants: null, waitlist_enabled: true,
  visibility: "public", directory_listed: true, directory_featured: false, directory_featured_rank: null, is_test: false,
  is_published: true, archived: false, archived_at: null, published_at: null, updated_at: null, phase: "upcoming",
  customer_id: 3, customer_name: "Org", plan: null, participants: 0, branded: true,
  directory: { listed: true, blockers: [] }, old_slugs: [], checklist: { ready: true, errors: [] },
  ...over,
});

describe("event editor", () => {
  it("shows dates on the event's own clock and sends only what changed", () => {
    const f = formOf(page());
    expect(f.start_date).toBe("2026-11-19T10:00");
    expect(changedFields(f, f)).toEqual({});
    const g = { ...f, name: "  Baku AI 2026 ", tagline: "Build", max_participants: "150", country: "az" };
    expect(changedFields(g, f)).toEqual({ name: "Baku AI 2026", tagline: "Build", max_participants: 150, country: "AZ" });
    expect(changedFields({ ...f, tagline: "" }, { ...f, tagline: "x" })).toEqual({ tagline: null });
  });

  it("re-sends the dates when the time zone changes (same clock, another moment)", () => {
    const f = formOf(page());
    const out = changedFields({ ...f, timezone: "Europe/London" }, f);
    expect(out.timezone).toBe("Europe/London");
    expect(out.start_date).toBe("2026-11-19T10:00:00.000Z");
    expect(out.registration_start).toBeUndefined();
  });

  it("catches an impossible schedule and a bad address before the API does", () => {
    const f = formOf(page());
    expect(localProblems(f)).toEqual({});
    expect(localProblems({ ...f, end_date: "2026-11-19T09:00" }).end_date).toMatch(/end after it starts/);
    expect(localProblems({ ...f, registration_end: "2026-11-22T10:00" }).registration_end).toMatch(/after the event ends/);
    expect(localProblems({ ...f, slug: "-bad-" }).slug).toBeTruthy();
    expect(localProblems({ ...f, max_participants: "0" }).max_participants).toBeTruthy();
    expect(localProblems({ ...f, name: " " }).name).toBeTruthy();
  });

  it("cleans a typed address", () => {
    expect(cleanSlug("Bakı AI  Hackathon!!")).toBe("bak-ai-hackathon-");
    expect(cleanSlug("--x")).toBe("x");
  });

  it("writes date ranges compactly", () => {
    expect(dateRange("2026-11-19T06:00:00Z", "2026-11-21T06:00:00Z", "Asia/Baku")).toBe("19–21 Nov 2026");
    expect(dateRange("2026-11-30T06:00:00Z", "2026-12-02T06:00:00Z", "UTC")).toBe("30 Nov – 2 Dec 2026");
    expect(dateRange("2026-12-30T06:00:00Z", "2027-01-02T06:00:00Z", "UTC")).toBe("30 Dec 2026 – 2 Jan 2027");
    expect(dateRange(null, null)).toBe("—");
  });

  it("says why an event is not in the directory", () => {
    expect(directoryLine(page())).toBe("Listed on /hackathons.");
    expect(directoryLine(page({ directory_featured: true, directory_featured_rank: 2 }))).toMatch(/pinned to the top \(position 2\)/);
    expect(directoryLine(page({ directory: { listed: false, blockers: ["test", "organiser_unlisted"] } })))
      .toBe('Not on /hackathons: it is marked as a test, "Show in HackOS directory" is off.');
    const row = { is_published: true, visibility: "public" as const, directory_listed: true, is_test: false, archived_at: null, phase: "upcoming" as const, slug: "x" };
    expect(inDirectory(row)).toBe(true);
    expect(inDirectory({ ...row, is_test: true })).toBe(false);
    expect(inDirectory({ ...row, visibility: "invite" })).toBe(false);
  });

  it("recognises test-looking names and the list's ready-made views", () => {
    expect(looksLikeTest("Verify EVC mvfm1r6n1sd")).toBe(true);
    expect(looksLikeTest("Unpaid Event 1792250823653")).toBe(true);
    expect(looksLikeTest("aud-be-evB")).toBe(true);
    expect(looksLikeTest("Bakı Süni İntellekt Hakatonu")).toBe(false);
    expect(looksLikeTest("Code Marathon 2026")).toBe(false);
    expect(viewOf({})).toBe("all");
    expect(viewOf({ test: ["looks"], customerId: ["3"] })).toBe("tests");
    expect(viewOf({ phase: ["running"] })).toBeNull();
    expect(new Set(EVENT_VIEWS.map((v) => v.id)).size).toBe(EVENT_VIEWS.length);
  });
});

describe("stories and the directory on the site", () => {
  it("reads the new story fields, with safe defaults for old stories", () => {
    const s = normalizeStory({ slug: "a", title: { en: "A" }, body: { en: "x" } })!;
    expect(s.bodyFormat).toBe("plain");
    expect(s.coverFocus).toEqual({ x: 50, y: 50 });
    expect(s.tags).toEqual([]);
    expect(s.event).toBeNull();
    const r = normalizeStory({ slug: "b", bodyFormat: "rich", coverFocus: { x: 30, y: 120 }, tags: ["AI", 4, ""], event: { name: "E", slug: "e" }, authorName: "Team" })!;
    expect(r.bodyFormat).toBe("rich");
    expect(r.coverFocus).toEqual({ x: 50, y: 50 });
    expect(r.tags).toEqual(["AI"]);
    expect(r.event).toEqual({ name: "E", slug: "e" });
    expect(focusPosition({ x: 30, y: 70 })).toBe("30% 70%");
    const o = normalizeOwnerStory({ id: 3, slug: "c", status: "scheduled", publishAt: "2026-11-01T10:00:00Z", live: false, title: { az: "C" }, body: {} })!;
    expect(o.status).toBe("scheduled");
    expect(o.live).toBe(false);
    expect(storyLangs(o)).toEqual(["az"]);
    expect(storySearchText({ ...o, tags: ["Baku"] })).toContain("baku");
    expect(normalizeEvent({ slug: "x", name: "X", featured: true })?.featured).toBe(true);
    expect(normalizeEvent({ slug: "x", name: "X" })?.featured).toBe(false);
  });

  it("has the directory's featured word in AZ, EN and RU", () => {
    for (const lang of ["az", "en", "ru"] as const) {
      expect(DIRECTORY_COPY[lang].featured.trim().length).toBeGreaterThan(0);
    }
  });

});
