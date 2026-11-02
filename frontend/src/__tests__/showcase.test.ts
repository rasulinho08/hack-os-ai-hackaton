/**
 * Stories from past hackathons: what the API sends is read defensively, a
 * story written in one language shows in it everywhere, the body splits
 * into paragraphs, dates read naturally in each language, and a refused
 * request says why in the owner's console.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import {
  formatDateRange, normalizeFigures, normalizeOwnerList, normalizeOwnerStory, normalizeStory, normalizeStoryCard, normalizeStoryList,
  normalizeWords, paragraphs, pickWords, pickedLang, publicStoryUrl, storyErrorText,
} from "@/lib/showcase";

const FILE = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

describe("normalizers", () => {
  it("keeps only the three languages, as text", () => {
    expect(normalizeWords({ az: "Salam", en: " ", ru: 4, de: "Hallo" })).toEqual({ az: "Salam" });
    expect(normalizeWords(null)).toEqual({});
  });

  it("keeps whole, non-negative figures", () => {
    expect(normalizeFigures({ participants: 120, teams: "32", projects: -1, hours: 4.5, extra: 9 })).toEqual({ participants: 120, teams: 32 });
    expect(normalizeFigures({ participants: "", teams: null })).toEqual({});
  });

  it("reads a list item, and drops one without an address", () => {
    const card = normalizeStoryCard({
      slug: "baku-ai-2026", title: { en: "Baku AI" }, heldFrom: "2026-04-25", heldTo: "26.04.2026",
      cover: { id: FILE }, photoCount: "7", location: "Baku",
    });
    expect(card).toMatchObject({
      slug: "baku-ai-2026", title: { en: "Baku AI" }, heldFrom: "2026-04-25", heldTo: null,
      cover: { id: FILE, url: `/api/files/${FILE}` }, photoCount: 7, location: "Baku", organisers: null,
    });
    expect(normalizeStoryCard({ title: { en: "x" } })).toBeNull();
    expect(normalizeStoryList({ items: [{ slug: "a" }, { nope: 1 }, { slug: "b" }] }).map((s) => s.slug)).toEqual(["a", "b"]);
    expect(normalizeStoryList([{ slug: "c" }]).map((s) => s.slug)).toEqual(["c"]);
    expect(normalizeStoryList("nothing")).toEqual([]);
  });

  it("reads a story with its photos and the owner's fields", () => {
    const raw = {
      id: 5, status: "published", eventId: "12", slug: "x", body: { ru: "Текст" },
      photos: [{ id: FILE, caption: "Opening" }, { caption: "no file" }, { id: FILE, url: "/elsewhere" }],
    };
    const story = normalizeStory(raw)!;
    expect(story.photos).toEqual([
      { id: FILE, url: `/api/files/${FILE}`, caption: "Opening" },
      { id: FILE, url: "/elsewhere", caption: null },
    ]);
    expect("photoCount" in story).toBe(false);
    const owner = normalizeOwnerStory(raw)!;
    expect(owner).toMatchObject({ id: 5, status: "published", eventId: 12 });
    expect(normalizeOwnerStory({ ...raw, status: "weird", eventId: "none" })).toMatchObject({ status: "draft", eventId: null });
    expect(normalizeOwnerStory({ slug: "x" })).toBeNull();
    expect(normalizeOwnerList([raw, { slug: "no-id" }]).map((s) => s.id)).toEqual([5]);
  });
});

describe("language fallback", () => {
  const words = { az: "Bakı", ru: "Баку" };

  it("uses the reader's language, then English, Azerbaijani, Russian", () => {
    expect(pickWords(words, "ru")).toBe("Баку");
    expect(pickWords(words, "en")).toBe("Bakı");
    expect(pickWords({ ru: "Только" }, "az")).toBe("Только");
    expect(pickWords({ en: "Hi", az: "Salam" }, "ru")).toBe("Hi");
    expect(pickWords({ en: "   " }, "en")).toBe("");
    expect(pickWords(null, "en")).toBe("");
  });

  it("says which language it used, for the lang attribute", () => {
    expect(pickedLang(words, "en")).toBe("az");
    expect(pickedLang(words, "ru")).toBe("ru");
    expect(pickedLang({}, "en")).toBeNull();
  });
});

describe("paragraphs", () => {
  it("splits on blank lines and keeps single line breaks", () => {
    expect(paragraphs("First line\nsame paragraph\n\n\nSecond\r\n\r\nThird  ")).toEqual(["First line\nsame paragraph", "Second", "Third"]);
    expect(paragraphs("   ")).toEqual([]);
  });

  it("never turns text into markup", () => {
    expect(paragraphs("<script>alert(1)</script>")).toEqual(["<script>alert(1)</script>"]);
  });
});

describe("formatDateRange", () => {
  it("writes a range inside one month, across months and across years", () => {
    expect(formatDateRange("2026-04-25", "2026-04-27", "en")).toBe("25–27 April 2026");
    expect(formatDateRange("2026-04-30", "2026-05-02", "en")).toBe("30 April – 2 May 2026");
    expect(formatDateRange("2025-12-30", "2026-01-02", "en")).toBe("30 December 2025 – 2 January 2026");
  });

  it("writes one day when there is one, and nothing when there is none", () => {
    expect(formatDateRange("2026-04-25", "2026-04-25", "en")).toBe("25 April 2026");
    expect(formatDateRange(null, "2026-04-27", "en")).toBe("27 April 2026");
    expect(formatDateRange(null, null, "en")).toBe("");
    expect(formatDateRange("2026-02-30", null, "en")).toBe("");
  });

  it("speaks Azerbaijani and Russian", () => {
    expect(formatDateRange("2026-04-25", "2026-04-27", "az")).toBe("25–27 aprel 2026");
    expect(formatDateRange("2026-04-30", "2026-05-02", "az")).toBe("30 aprel – 2 may 2026");
    expect(formatDateRange("2026-04-25", "2026-04-27", "ru")).toMatch(/^25–27 апреля 2026/);
  });
});

describe("the owner's messages and links", () => {
  it("say what the API refused", () => {
    expect(storyErrorText(new ApiError("x", 400, [], "TITLE_REQUIRED"))).toMatch(/title/i);
    expect(storyErrorText(new ApiError("x", 409, [], "SLUG_TAKEN"))).toMatch(/address/i);
    expect(storyErrorText(new ApiError("x", 413, [], "FILE_TOO_LARGE"))).toMatch(/5 MB/);
    expect(storyErrorText(new ApiError("x", 415, [], "FILE_TYPE_NOT_ALLOWED"))).toMatch(/JPEG/);
    expect(storyErrorText(new ApiError("x", 404))).toMatch(/not there/);
    expect(storyErrorText(new ApiError("x", 401))).toMatch(/Sign in/);
    expect(storyErrorText(new ApiError("Check the story and try again.: heldTo: Ends before it starts.", 400, [], "VALIDATION_ERROR", "Check the story and try again."))).toBe("Check the story and try again.");
    expect(storyErrorText(new Error("offline"))).toBe("offline");
  });

  it("link to the public page on the same host when the console has none of its own", () => {
    expect(publicStoryUrl("baku-ai-2026")).toBe("/stories/baku-ai-2026");
  });
});
