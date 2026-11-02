/**
 * The event gallery's helpers: what the API sends is read defensively, a
 * share's outcome per channel maps to its sentence, a failed request to its
 * message, and moving a photo saves only the positions that changed. The
 * walkthrough's answer reads like the real one.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import en from "@/lib/i18n/gallery/en";
import {
  CHAT_OUTCOMES, EMAIL_OUTCOMES, GALLERY_ERROR_CODES, MAX_PHOTOS, galleryErrorKey, galleryPagePath, normalizeGallery, normalizePhoto,
  normalizeShare, reorder, shareOutcomeKey, shareReached, type GalleryPhoto,
} from "@/lib/gallery";
import { resolveDemoRead } from "@/lib/demo/resolve";
import { resolveGalleryDemo } from "@/lib/demo/gallery";

const FILE = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

describe("normalizePhoto / normalizeGallery", () => {
  it("keeps a photo with an id and a file, and fills in its address", () => {
    expect(normalizePhoto({ id: 3, fileId: FILE, caption: "  ", position: "2" })).toEqual({
      id: 3, fileId: FILE, url: `/api/files/${FILE}`, caption: null, position: 2, createdAt: null,
    });
    expect(normalizePhoto({ id: 0, fileId: FILE })).toBeNull();
    expect(normalizePhoto({ id: 4 })).toBeNull();
    expect(normalizePhoto(null)).toBeNull();
  });

  it("reads the view, sorts the photos by position and defaults what is missing", () => {
    const v = normalizeGallery({
      enabled: true, canManage: true, eventId: 7, eventSlug: "baku-ai", eventName: "Baku AI",
      items: [{ id: 2, fileId: FILE, position: 5 }, { id: 1, fileId: FILE, position: 1 }, { nope: true }],
      shared: { chatAt: "2026-05-01T10:00:00.000Z" },
    });
    expect(v).not.toBeNull();
    expect(v!.items.map((p) => p.id)).toEqual([1, 2]);
    expect(v!.maxPhotos).toBe(MAX_PHOTOS);
    expect(v!.shared).toEqual({ chatAt: "2026-05-01T10:00:00.000Z", emailAt: null });
    expect(v!.canManage).toBe(true);
    expect(normalizeGallery({ eventId: "x" })).toBeNull();
    expect(normalizeGallery({ eventId: 9 })!.canManage).toBe(false);
    expect(normalizeGallery({ eventId: 9, enabled: false })!.enabled).toBe(false);
  });
});

describe("sharing", () => {
  it("reads only the outcomes the API defines", () => {
    expect(normalizeShare({ chat: "sent", email: "limit", link: "https://hack-os.app/e/x/gallery" })).toEqual({
      chat: "sent", email: "limit", link: "https://hack-os.app/e/x/gallery",
    });
    expect(normalizeShare({ chat: "posted", email: 3 })).toEqual({ chat: null, email: null, link: null });
  });

  it("names a sentence for every outcome, and none for a channel not asked", () => {
    for (const o of CHAT_OUTCOMES) expect(en[shareOutcomeKey("chat", o)!], o).toBeTruthy();
    for (const o of EMAIL_OUTCOMES) expect(en[shareOutcomeKey("email", o)!], o).toBeTruthy();
    expect(shareOutcomeKey("chat", null)).toBeNull();
  });

  it("counts a share as reaching people when either channel went out", () => {
    expect(shareReached({ chat: "sent", email: null, link: null })).toBe(true);
    expect(shareReached({ chat: "off", email: "queued", link: null })).toBe(true);
    expect(shareReached({ chat: "off", email: "limit", link: null })).toBe(false);
    expect(shareReached({ chat: null, email: "not_in_plan", link: null })).toBe(false);
  });

  it("links to the members' page by the event's address", () => {
    expect(galleryPagePath("baku-ai-2026")).toBe("/e/baku-ai-2026/gallery");
    expect(galleryPagePath("a b")).toBe("/e/a%20b/gallery");
  });
});

describe("galleryErrorKey", () => {
  it("maps the API's codes, then the status, then a generic line — all of them written", () => {
    expect(galleryErrorKey(new ApiError("x", 409, [], "EVENT_ARCHIVED"))).toBe("gl.err.EVENT_ARCHIVED");
    expect(galleryErrorKey(new ApiError("x", 409, [], "GALLERY_FULL"))).toBe("gl.err.GALLERY_FULL");
    expect(galleryErrorKey(new ApiError("x", 507, [], "PLAN_STORAGE_FULL"))).toBe("gl.err.STORAGE_FULL");
    expect(galleryErrorKey(new ApiError("x", 403, [], "MODULE_DISABLED"))).toBe("gl.err.MODULE_DISABLED");
    expect(galleryErrorKey(new ApiError("x", 403))).toBe("gl.err.FORBIDDEN");
    expect(galleryErrorKey(new ApiError("x", 404))).toBe("gl.err.NOT_FOUND");
    expect(galleryErrorKey(new ApiError("x", 429, [], "RATE_LIMITED"))).toBe("gl.err.RATE_LIMITED");
    expect(galleryErrorKey(new ApiError("x", 500))).toBe("gl.err.generic");
    expect(galleryErrorKey(new Error("offline"))).toBe("gl.err.generic");
    for (const code of GALLERY_ERROR_CODES) expect(en[`gl.err.${code}`], code).toBeTruthy();
  });
});

describe("reorder", () => {
  const photo = (id: number, position: number): GalleryPhoto => ({ id, fileId: FILE, url: "", caption: null, position, createdAt: null });

  it("swaps a photo with its neighbour and saves the two positions", () => {
    const { order, changes } = reorder([photo(1, 1), photo(2, 2), photo(3, 3)], 3, -1);
    expect(order.map((p) => p.id)).toEqual([1, 3, 2]);
    expect(order.map((p) => p.position)).toEqual([1, 2, 3]);
    expect(changes).toEqual([{ id: 3, position: 2 }, { id: 2, position: 3 }]);
  });

  it("renumbers gaps left by deleted photos", () => {
    const { order, changes } = reorder([photo(1, 1), photo(2, 4), photo(3, 9)], 1, 1);
    expect(order.map((p) => [p.id, p.position])).toEqual([[2, 1], [1, 2], [3, 3]]);
    expect(changes).toEqual([{ id: 2, position: 1 }, { id: 1, position: 2 }, { id: 3, position: 3 }]);
  });

  it("does nothing at the ends or for a photo that is not there", () => {
    const items = [photo(1, 1), photo(2, 2)];
    expect(reorder(items, 1, -1)).toEqual({ order: items, changes: [] });
    expect(reorder(items, 2, 1)).toEqual({ order: items, changes: [] });
    expect(reorder(items, 9, 1)).toEqual({ order: items, changes: [] });
  });
});

describe("the walkthrough's gallery", () => {
  it("answers the organiser screen's read with a gallery the screen can show", () => {
    const v = normalizeGallery(resolveDemoRead("/api/events/1/gallery"));
    expect(v).not.toBeNull();
    expect(v!.canManage).toBe(true);
    expect(v!.items.length).toBeGreaterThan(3);
    expect(v!.items.every((p) => p.url.startsWith("data:image/svg+xml"))).toBe(true);
    expect(new Set(v!.items.map((p) => p.position)).size).toBe(v!.items.length);
    expect(v!.eventSlug).toBeTruthy();
  });

  it("is the same picture on every visit and recognises nothing else", () => {
    expect(JSON.stringify(resolveGalleryDemo(["events", "1", "gallery"]))).toBe(JSON.stringify(resolveGalleryDemo(["events", "1", "gallery"])));
    expect(resolveGalleryDemo(["events", "1", "gallery", "share"])).toBeUndefined();
    expect(resolveGalleryDemo(["gallery", "demo"])).toBeUndefined();
  });
});
