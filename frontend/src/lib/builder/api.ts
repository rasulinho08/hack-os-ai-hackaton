/**
 * Calls of the event builder. Everything goes through the shared api()
 * client except uploads, whose body is the file itself.
 */

import { ApiError, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import type {
  BuilderEvent, BuilderPayload, Catalog, ChecklistItem, ListKind, SyncResult, UploadedFile,
} from "./types";

export const loadCatalog = () => apiGet<Catalog>("/api/events/builder/catalog");

export const createDraft = (body: { name: string; template: string; language: string; timezone: string }) =>
  apiPost<BuilderPayload>("/api/events/drafts", body);

export const loadBuilder = (eventId: number) => apiGet<BuilderPayload>(`/api/events/${eventId}/builder`);

export const patchEvent = (eventId: number, fields: Record<string, unknown>) =>
  apiPatch<{ event: BuilderEvent; checklist: ChecklistItem[]; ready: boolean }>(`/api/events/${eventId}/builder`, fields);

export function syncList<T>(eventId: number, kind: ListKind, items: unknown[]) {
  return apiPut<SyncResult<T>>(`/api/events/${eventId}/builder/${kind}`, { items });
}

export const publishEvent = (eventId: number) => apiPost<BuilderPayload>(`/api/events/${eventId}/builder/publish`, {});
export const unpublishEvent = (eventId: number) => apiPost<BuilderPayload>(`/api/events/${eventId}/builder/unpublish`, {});

/** Upload a file for an event; the API decides what it is from its bytes. */
export async function uploadFile(eventId: number, purpose: string, file: Blob, name: string): Promise<UploadedFile> {
  const res = await fetch(`/api/files?purpose=${encodeURIComponent(purpose)}&eventId=${eventId}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(name),
    },
    body: file,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new ApiError(json?.message || `Upload failed (${res.status})`, res.status, json?.errors || []);
  }
  return json.data as UploadedFile;
}
