/**
 * An event's photo gallery (plan module 'gallery').
 *
 *   GET    /api/events/:eventId/gallery              the photos; canManage for organisers
 *   GET    /api/gallery/:slug                        the same, by the event's public address
 *   POST   /api/events/:eventId/gallery              { fileIds } organiser: add uploaded photos
 *   PATCH  /api/events/:eventId/gallery/:photoId     { caption?, position? }
 *   DELETE /api/events/:eventId/gallery/:photoId     the photo and its file
 *   POST   /api/events/:eventId/gallery/share        { chat?, email?, message? }
 *
 * Photos are uploaded first with POST /api/files?purpose=gallery&eventId=
 * (organisers only), then added. The event's people — approved participants,
 * judges, mentors, volunteers — read it; anyone else gets 404.
 */

import { ApiError, DemoReadOnlyError, apiDelete, apiGet, apiPatch, apiPost, isDemoApiEnabled } from "@/lib/api";
import { sendFile } from "@/lib/upload";

export interface GalleryPhoto {
  id: number;
  fileId: string;
  url: string;
  caption: string | null;
  position: number;
  createdAt: string | null;
}

export interface GalleryView {
  enabled: boolean;
  canManage: boolean;
  eventId: number;
  eventSlug: string | null;
  eventName: string;
  startDate: string | null;
  endDate: string | null;
  maxPhotos: number;
  items: GalleryPhoto[];
  shared: { chatAt: string | null; emailAt: string | null };
}

export type ChatOutcome = "sent" | "off" | "not_in_plan";
export type EmailOutcome = "queued" | "not_in_plan" | "limit";
export interface ShareResult {
  chat: ChatOutcome | null;
  email: EmailOutcome | null;
  link: string | null;
}

export const MAX_PHOTOS = 200;
export const MAX_CAPTION = 200;
export const MAX_MESSAGE = 500;
export const CHAT_OUTCOMES: ChatOutcome[] = ["sent", "off", "not_in_plan"];
export const EMAIL_OUTCOMES: EmailOutcome[] = ["queued", "not_in_plan", "limit"];

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function normalizePhoto(v: unknown): GalleryPhoto | null {
  const o = obj(v);
  const id = Number(o.id);
  const fileId = str(o.fileId);
  if (!Number.isInteger(id) || id <= 0 || !fileId) return null;
  return {
    id,
    fileId,
    url: str(o.url) ?? `/api/files/${fileId}`,
    caption: str(o.caption),
    position: Number.isFinite(Number(o.position)) ? Number(o.position) : 0,
    createdAt: str(o.createdAt),
  };
}

export function normalizeGallery(v: unknown): GalleryView | null {
  const o = obj(v);
  const eventId = Number(o.eventId);
  if (!Number.isInteger(eventId) || eventId <= 0) return null;
  const items = (Array.isArray(o.items) ? o.items : [])
    .map(normalizePhoto)
    .filter((p): p is GalleryPhoto => p != null)
    .sort((a, b) => a.position - b.position || a.id - b.id);
  const shared = obj(o.shared);
  const max = Number(o.maxPhotos);
  return {
    enabled: o.enabled !== false,
    canManage: o.canManage === true,
    eventId,
    eventSlug: str(o.eventSlug),
    eventName: str(o.eventName) ?? "",
    startDate: str(o.startDate),
    endDate: str(o.endDate),
    maxPhotos: Number.isInteger(max) && max > 0 ? max : MAX_PHOTOS,
    items,
    shared: { chatAt: str(shared.chatAt), emailAt: str(shared.emailAt) },
  };
}

export function normalizeShare(v: unknown): ShareResult {
  const o = obj(v);
  const chat = (CHAT_OUTCOMES as string[]).includes(String(o.chat)) ? (o.chat as ChatOutcome) : null;
  const email = (EMAIL_OUTCOMES as string[]).includes(String(o.email)) ? (o.email as EmailOutcome) : null;
  return { chat, email, link: str(o.link) };
}

/** The i18n key that says what happened on one channel of a share (null: not asked). */
export function shareOutcomeKey(channel: "chat" | "email", outcome: ChatOutcome | EmailOutcome | null): string | null {
  if (!outcome) return null;
  return `gl.share.${channel}.${outcome}`;
}

/** Whether a share reached anyone at all (the toast's tone). */
export function shareReached(r: ShareResult): boolean {
  return r.chat === "sent" || r.email === "queued";
}

/** The members' page of an event's gallery (the link that is shared). */
export function galleryPagePath(slug: string): string {
  return `/e/${encodeURIComponent(slug)}/gallery`;
}

/** The i18n key for a failed gallery request. */
export function galleryErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "EVENT_ARCHIVED": return "gl.err.EVENT_ARCHIVED";
      case "GALLERY_FULL": return "gl.err.GALLERY_FULL";
      case "GALLERY_EMPTY": return "gl.err.GALLERY_EMPTY";
      case "NO_EVENT_PAGE": return "gl.err.NO_EVENT_PAGE";
      case "MODULE_DISABLED": return "gl.err.MODULE_DISABLED";
      case "FILE_TOO_LARGE": return "gl.err.FILE_TOO_LARGE";
      case "FILE_TYPE_NOT_ALLOWED": return "gl.err.FILE_TYPE_NOT_ALLOWED";
      case "STORAGE_FULL":
      case "PLAN_STORAGE_FULL": return "gl.err.STORAGE_FULL";
      case "VALIDATION_ERROR": return "gl.err.VALIDATION_ERROR";
      default: break;
    }
    if (err.status === 403) return "gl.err.FORBIDDEN";
    if (err.status === 404) return "gl.err.NOT_FOUND";
    if (err.status === 429) return "gl.err.RATE_LIMITED";
  }
  return "gl.err.generic";
}

export const GALLERY_ERROR_CODES = [
  "EVENT_ARCHIVED", "GALLERY_FULL", "GALLERY_EMPTY", "NO_EVENT_PAGE", "MODULE_DISABLED", "FILE_TOO_LARGE",
  "FILE_TYPE_NOT_ALLOWED", "STORAGE_FULL", "VALIDATION_ERROR", "FORBIDDEN", "NOT_FOUND", "RATE_LIMITED", "generic",
] as const;

/** Moves one photo up or down; the new positions to save (only those that changed). */
export function reorder(items: GalleryPhoto[], id: number, dir: -1 | 1): { order: GalleryPhoto[]; changes: { id: number; position: number }[] } {
  const order = [...items];
  const i = order.findIndex((p) => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return { order: items, changes: [] };
  [order[i], order[j]] = [order[j], order[i]];
  // Positions 1..n in the new order; only rows whose number moved are saved.
  const changes: { id: number; position: number }[] = [];
  const renumbered = order.map((p, k) => {
    const position = k + 1;
    if (p.position !== position) changes.push({ id: p.id, position });
    return { ...p, position };
  });
  return { order: renumbered, changes };
}

const base = (eventId: number) => `/api/events/${eventId}/gallery`;

export const galleryApi = {
  get: async (eventId: number) => normalizeGallery(await apiGet<unknown>(base(eventId))),
  bySlug: async (slug: string) => normalizeGallery(await apiGet<unknown>(`/api/gallery/${encodeURIComponent(slug)}`)),
  add: async (eventId: number, fileIds: string[]) => normalizeGallery(await apiPost<unknown>(base(eventId), { fileIds })),
  update: async (eventId: number, photoId: number, body: { caption?: string | null; position?: number }) =>
    normalizeGallery(await apiPatch<unknown>(`${base(eventId)}/${photoId}`, body)),
  remove: (eventId: number, photoId: number) => apiDelete<unknown>(`${base(eventId)}/${photoId}`),
  share: async (eventId: number, body: { chat?: boolean; email?: boolean; message?: string }) =>
    normalizeShare(await apiPost<unknown>(`${base(eventId)}/share`, body)),
  /** One photo (already resized) for this event's gallery; the walkthrough refuses it like any write. */
  async upload(eventId: number, blob: Blob, name: string, onProgress?: (fraction: number) => void): Promise<{ id: string; url: string }> {
    if (isDemoApiEnabled()) {
      window.dispatchEvent(new CustomEvent("hackos:demo-write"));
      throw new DemoReadOnlyError();
    }
    const data = obj(await sendFile(`/api/files?purpose=gallery&eventId=${eventId}`, blob, name, onProgress));
    const id = str(data.id);
    if (!id) throw new ApiError("Upload failed", 500);
    return { id, url: str(data.url) ?? `/api/files/${id}` };
  },
};
