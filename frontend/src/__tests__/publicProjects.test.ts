/**
 * The public projects page's helpers: what the API sends is read again
 * defensively (only http(s) links, only a hex colour, only the event's own
 * images), winners and tracks are picked the way the page shows them, failed
 * requests map to their sentence, and the walkthrough answers the organiser's
 * switch like the API.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import en from "@/lib/i18n/projects/en";
import {
  PROJECTS_ERROR_CODES, eventPathOf, inTrack, isWinner, normalizeMine, normalizeOrganiserState, normalizeProject,
  normalizePublicProjects, organiserPhase, projectsErrorKey, projectsPagePath, safeColor, safeImage, safeLink, shownAwards,
} from "@/lib/publicProjects";
import { resolveDemoRead } from "@/lib/demo/resolve";
import { resolveResultsDemo } from "@/lib/demo/results";

const FILE = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

describe("safeLink / safeColor / safeImage", () => {
  it("keeps http(s) addresses and drops every other scheme", () => {
    expect(safeLink("https://github.com/team/app")).toBe("https://github.com/team/app");
    expect(safeLink("  http://demo.example.az/x?y=1  ")).toBe("http://demo.example.az/x?y=1");
    for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<b>x</b>", "ftp://files.example.com", "vbscript:x", "//evil.example", "github.com/team"]) {
      expect(safeLink(bad), bad).toBeNull();
    }
    expect(safeLink("https://a.example/ b")).toBeNull();
    expect(safeLink(`https://a.example/${"x".repeat(500)}`)).toBeNull();
    expect(safeLink(null)).toBeNull();
    expect(safeLink(42)).toBeNull();
  });

  it("takes a hex colour only (it goes into a style attribute)", () => {
    expect(safeColor("#E1003C")).toBe("#E1003C");
    expect(safeColor("#abc")).toBe("#abc");
    for (const bad of ["red", "#12345", "#E1003C; background:url(x)", "rgb(1,2,3)", "", null]) expect(safeColor(bad), String(bad)).toBeNull();
  });

  it("takes the event's own files or an https image, nothing that could break out of url()", () => {
    expect(safeImage(`/api/files/${FILE}`)).toBe(`/api/files/${FILE}`);
    expect(safeImage("https://cdn.example.az/logo.png")).toBe("https://cdn.example.az/logo.png");
    expect(safeImage("http://cdn.example.az/logo.png")).toBeNull();
    expect(safeImage('https://cdn.example.az/a.png") ; x("')).toBeNull();
    expect(safeImage("https://cdn.example.az/a(1).png")).toBeNull();
    expect(safeImage("/api/files/../../etc")).toBeNull();
    expect(safeImage("javascript:alert(1)")).toBeNull();
  });
});

describe("normalizePublicProjects", () => {
  const raw = {
    event: {
      name: "Gəncə Hackathon", slug: "gence-hackathon", tagline: "", language: "az", startDate: "2026-10-01T06:00:00.000Z",
      endDate: "2026-10-02T14:00:00.000Z", timezone: "Asia/Baku", organiser: "Gəncə Tech", archived: false,
      brandColor: "#0F7B48", logoUrl: `/api/files/${FILE}`, bannerUrl: "javascript:alert(1)",
    },
    resultsPublishedAt: "2026-10-02T15:00:00.000Z",
    places: "winners",
    tracks: [{ id: 3, name: "Fintech" }, { id: 0, name: "Bad" }, { id: 4 }],
    projects: [
      { id: 11, title: "Kassa", teamName: "Alfa", place: 1, trackId: 3, track: "Fintech", awards: [{ name: "1st place", kind: "place", value: "1000 AZN" }, { kind: "special" }],
        links: { repo: "https://github.com/alfa/kassa", demo: "javascript:alert(1)", video: "ftp://x" } },
      { id: 12, title: "  ", teamName: "Beta" },
      { id: "x", title: "No id" },
      { id: 13, title: "Yol", teamName: "Qamma", place: 0, awards: "nope", links: null },
    ],
  };

  it("keeps the event, drops what the page must not show, and defaults the rest", () => {
    const p = normalizePublicProjects(raw);
    expect(p).not.toBeNull();
    if (!p) return;
    expect(p.event).toMatchObject({ name: "Gəncə Hackathon", slug: "gence-hackathon", tagline: null, language: "az", brandColor: "#0F7B48", logoUrl: `/api/files/${FILE}`, bannerUrl: null });
    expect(p.places).toBe("winners");
    expect(p.tracks).toEqual([{ id: 3, name: "Fintech" }]);
    expect(p.projects.map((x) => x.id)).toEqual([11, 13]);
    expect(p.projects[0].links).toEqual({ repo: "https://github.com/alfa/kassa", demo: null, video: null });
    expect(p.projects[0].awards).toEqual([{ name: "1st place", kind: "place", value: "1000 AZN" }]);
    expect(p.projects[1]).toMatchObject({ place: null, awards: [], links: { repo: null, demo: null, video: null }, trackId: null });
  });

  it("is null without an event name or slug, and reads an unknown language as the event default", () => {
    expect(normalizePublicProjects(null)).toBeNull();
    expect(normalizePublicProjects({ event: { name: "X" } })).toBeNull();
    expect(normalizePublicProjects({ event: { name: "X", slug: "x", language: "de" }, places: "all" })).toMatchObject({ event: { language: "az" }, places: "all", projects: [], tracks: [] });
  });

  it("never carries people or scores, even when the API sent them", () => {
    const p = normalizeProject({ id: 1, title: "T", members: [{ email: "a@example.az" }], score: 91.5, leaderEmail: "a@example.az" });
    expect(p).not.toBeNull();
    expect(JSON.stringify(p)).not.toMatch(/example\.az|91\.5|members|score/);
  });
});

describe("winners and tracks", () => {
  const p = (id: number, place: number | null, awards: number, trackId: number | null) =>
    normalizeProject({ id, title: `P${id}`, place, trackId, awards: Array.from({ length: awards }, (_, i) => ({ name: `A${i}` })) });
  const list = [p(1, 1, 0, 3), p(2, null, 1, 4), p(3, null, 0, 3), p(4, 2, 1, null)].filter((x) => x != null);

  it("count a place or any prize as a win", () => {
    expect(list.filter(isWinner).map((x) => x.id)).toEqual([1, 2, 4]);
  });

  it("name a place prize only when it adds a value, every other prize always", () => {
    const placed = normalizeProject({ id: 9, title: "T", place: 1, awards: [{ name: "1st place", kind: "place" }, { name: "Grand", kind: "place", value: "1000 AZN" }, { name: "Best design", kind: "special" }] });
    expect(placed && shownAwards(placed).map((a) => a.name)).toEqual(["Grand", "Best design"]);
    // Without a public place (winners-only results), the place prize is what says it won.
    const unplaced = normalizeProject({ id: 10, title: "U", place: null, awards: [{ name: "1st place", kind: "place" }] });
    expect(unplaced && shownAwards(unplaced).map((a) => a.name)).toEqual(["1st place"]);
  });

  it("filter by track in the API's order, everything without one", () => {
    expect(inTrack(list, 3).map((x) => x.id)).toEqual([1, 3]);
    expect(inTrack(list, null).map((x) => x.id)).toEqual([1, 2, 3, 4]);
    expect(inTrack(list, 99)).toEqual([]);
  });
});

describe("the organiser's switch and the team lead's state", () => {
  it("read the switch, with counts that are never negative or fractional", () => {
    const s = normalizeOrganiserState({ public: true, publicSince: "2026-10-02T15:00:00Z", resultsPublished: false, eventPublished: true, live: false, slug: "x", projects: { listed: 4, hidden: -1, eliminated: 1.5 } });
    expect(s.projects).toEqual({ listed: 4, hidden: 0, eliminated: 0 });
    expect(organiserPhase(s)).toBe("waiting");
    expect(organiserPhase({ ...s, live: true })).toBe("live");
    expect(organiserPhase({ ...s, public: false, live: true })).toBe("off");
    expect(normalizeOrganiserState(null)).toMatchObject({ public: false, live: false, slug: null, projects: { listed: 0, hidden: 0, eliminated: 0 } });
  });

  it("read the participant's team, or none", () => {
    expect(normalizeMine({ public: true, live: true, slug: "x", team: { id: 7, name: "Alfa", isLead: true, hidden: true, hasProject: true, eliminated: false } }).team)
      .toEqual({ id: 7, name: "Alfa", isLead: true, hidden: true, hasProject: true, eliminated: false });
    expect(normalizeMine({ public: true, team: null }).team).toBeNull();
    expect(normalizeMine({ team: { id: "x" } }).team).toBeNull();
    // Anything but true is false: a missing flag never shows a project or a lead's switch.
    expect(normalizeMine({ team: { id: 7, isLead: "yes", hidden: 1 } }).team).toMatchObject({ isLead: false, hidden: false });
  });
});

describe("addresses and errors", () => {
  it("build the page's address and find the event page from it", () => {
    expect(projectsPagePath("gence-hackathon")).toBe("/e/gence-hackathon/projects");
    expect(projectsPagePath("a b/c")).toBe("/e/a%20b%2Fc/projects");
    expect(eventPathOf("/e/gence-hackathon/projects")).toBe("/e/gence-hackathon");
    expect(eventPathOf("/e/gence-hackathon/projects/")).toBe("/e/gence-hackathon");
    expect(eventPathOf("/e/gence-hackathon")).toBeNull();
    expect(eventPathOf("/e/a/b/projects")).toBeNull();
    expect(eventPathOf(null)).toBeNull();
  });

  it("map each failure to a sentence that exists", () => {
    expect(projectsErrorKey(new ApiError("x", 409, [], "EVENT_ARCHIVED"))).toBe("pj.err.EVENT_ARCHIVED");
    expect(projectsErrorKey(new ApiError("x", 403, [], "NOT_TEAM_LEAD"))).toBe("pj.err.NOT_TEAM_LEAD");
    expect(projectsErrorKey(new ApiError("x", 409, [], "NO_TEAM"))).toBe("pj.err.NO_TEAM");
    expect(projectsErrorKey(new ApiError("x", 403))).toBe("pj.err.FORBIDDEN");
    expect(projectsErrorKey(new ApiError("x", 404))).toBe("pj.err.NOT_FOUND");
    expect(projectsErrorKey(new ApiError("x", 429))).toBe("pj.err.RATE_LIMITED");
    expect(projectsErrorKey(new ApiError("x", 500, [], "generic"))).toBe("pj.err.generic");
    expect(projectsErrorKey(new Error("boom"))).toBe("pj.err.generic");
    for (const code of PROJECTS_ERROR_CODES) expect(en[`pj.err.${code}`], code).toBeTruthy();
  });
});

describe("walkthrough", () => {
  it("answers the organiser's switch: closed, waiting for results, with the sample's counts", () => {
    const s = normalizeOrganiserState(resolveDemoRead("/api/events/1/results/projects"));
    expect(s).toMatchObject({ public: false, resultsPublished: false, eventPublished: true, live: false });
    expect(s.projects.listed).toBeGreaterThan(5);
    expect(s.projects.eliminated).toBeGreaterThan(0);
    expect(resolveResultsDemo(["events", "1", "results", "projects", "mine"])).toBeUndefined();
  });
});
