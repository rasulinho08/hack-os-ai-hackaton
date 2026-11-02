"use client";

/**
 * The event's photo gallery (plan module 'gallery').
 *
 * The organisers put the weekend's photos up — made smaller in the browser
 * before they are sent — caption them, put them in order, and tell the
 * event's people where they are: a post in the general chat and an
 * announcement in the app and by e-mail, both carrying the link to the
 * members' page, which only the people who took part can open. An archived
 * event's gallery can be looked at, not changed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, CheckCircle2, Copy, ExternalLink, ImagePlus, Images, Loader2, RefreshCw, Share2, Trash2,
} from "lucide-react";
import { Button, Card, CardHeader, EmptyState, Progress, Skeleton, buttonLook } from "@/components/ds/primitives";
import { Notice, TextArea, Toggle, inputStyle } from "@/components/builder/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadFailure } from "@/components/LoadFailure";
import { PhotoLightbox, type LightboxPhoto } from "@/components/site/PhotoLightbox";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { ApiError, DemoReadOnlyError, isDemoApiEnabled } from "@/lib/api";
import {
  MAX_CAPTION, MAX_MESSAGE, MAX_PHOTOS, galleryApi, galleryErrorKey, galleryPagePath, reorder, shareOutcomeKey, shareReached,
  type GalleryPhoto, type GalleryView, type ShareResult,
} from "@/lib/gallery";
import { ACCEPT_ATTR, ImageError, prepareImage } from "@/lib/imageResize";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";

type T = (key: string) => string;

interface Loaded {
  eventId: number;
  view: GalleryView | null;
  /** The i18n key of why it did not load (null: it did). */
  error: string | null;
}

type UploadState = "waiting" | "preparing" | "uploading" | "done" | "failed" | "skipped";
interface UploadRow {
  key: string;
  name: string;
  state: UploadState;
  progress: number;
  message: string | null;
}

/** Refusals after which sending the rest of a batch is pointless. */
const STOPS = new Set(["EVENT_ARCHIVED", "GALLERY_FULL", "MODULE_DISABLED", "STORAGE_FULL", "PLAN_STORAGE_FULL"]);
const stopsBatch = (err: unknown) =>
  err instanceof ApiError && (STOPS.has(String(err.code)) || err.status === 401 || err.status === 403 || err.status === 429);

/** The walkthrough has no members' page to open. */
const demoRefusal = (e: { preventDefault: () => void }) => {
  if (!isDemoApiEnabled()) return;
  e.preventDefault();
  window.dispatchEvent(new CustomEvent("hackos:demo-write"));
};

export default function GalleryPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { activeEventId, primaryEvent, loading: eventLoading } = useActiveEvent();
  const [data, setData] = useState<Loaded | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [archivedEvent, setArchivedEvent] = useState<number | null>(null);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [moving, setMoving] = useState(false);
  const [toDelete, setToDelete] = useState<GalleryPhoto | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeEventId == null) return;
    let cancelled = false;
    galleryApi.get(activeEventId).then(
      (view) => { if (!cancelled) setData({ eventId: activeEventId, view, error: view ? null : "gl.load_failed" }); },
      (err) => {
        if (cancelled) return;
        const moduleOff = err instanceof ApiError && err.code === "MODULE_DISABLED";
        setData({ eventId: activeEventId, view: null, error: moduleOff ? "gl.err.MODULE_DISABLED" : "gl.load_failed" });
      },
    );
    return () => { cancelled = true; };
  }, [activeEventId]);

  const current = data && data.eventId === activeEventId ? data : null;
  const view = current?.view ?? null;
  const loading = eventLoading || (activeEventId != null && !current);
  const status = String(primaryEvent?.derived_status || primaryEvent?.status || "").toLowerCase();
  const archived = status === "archived" || (archivedEvent != null && archivedEvent === activeEventId);
  const canEdit = Boolean(view?.canManage) && !archived;
  const items = view?.items ?? [];
  const max = view?.maxPhotos ?? MAX_PHOTOS;
  const room = Math.max(0, max - items.length);

  const apply = useCallback((eventId: number, next: GalleryView | null) => {
    if (next) setData({ eventId, view: next, error: null });
  }, []);

  const reload = useCallback(async () => {
    if (activeEventId == null) return;
    setRefreshing(true);
    try {
      const next = await galleryApi.get(activeEventId);
      if (next) apply(activeEventId, next);
      else toast(t("gl.load_failed"), "error");
    } catch (err) {
      if (current?.view) toast(t(galleryErrorKey(err)), "error");
      else setData({ eventId: activeEventId, view: null, error: err instanceof ApiError && err.code === "MODULE_DISABLED" ? "gl.err.MODULE_DISABLED" : "gl.load_failed" });
    } finally {
      setRefreshing(false);
    }
  }, [activeEventId, apply, current?.view, t, toast]);

  /** A write refused in the walkthrough is announced by the walkthrough itself. */
  const fail = useCallback((err: unknown) => {
    if (err instanceof DemoReadOnlyError) return;
    if (err instanceof ApiError && err.code === "EVENT_ARCHIVED" && activeEventId != null) setArchivedEvent(activeEventId);
    toast(t(galleryErrorKey(err)), "error");
  }, [activeEventId, t, toast]);

  /* ── Uploads ────────────────────────────────────────────────────────── */

  const patchRow = (key: string, patch: Partial<UploadRow>) =>
    setUploads((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addFiles = async (files: File[]) => {
    if (activeEventId == null || !canEdit || uploading || !files.length) return;
    if (isDemoApiEnabled()) {
      window.dispatchEvent(new CustomEvent("hackos:demo-write"));
      return;
    }
    const eventId = activeEventId;
    const stamp = Date.now();
    const rows: UploadRow[] = files.map((f, i) => ({
      key: `${stamp}-${i}`,
      name: f.name || `photo-${i + 1}`,
      state: i < room ? "waiting" : "failed",
      progress: 0,
      message: i < room ? null : t("gl.err.GALLERY_FULL"),
    }));
    setUploads(rows);
    setUploading(true);
    let added = 0;
    let failed = Math.max(0, files.length - room);
    let stop: string | null = null;
    for (let i = 0; i < Math.min(room, files.length); i += 1) {
      const row = rows[i];
      if (stop) {
        patchRow(row.key, { state: "skipped", message: stop });
        failed += 1;
        continue;
      }
      try {
        patchRow(row.key, { state: "preparing" });
        const prepared = await prepareImage(files[i]);
        patchRow(row.key, { state: "uploading", progress: 0 });
        const file = await galleryApi.upload(eventId, prepared.blob, prepared.name, (p) => patchRow(row.key, { progress: p }));
        apply(eventId, await galleryApi.add(eventId, [file.id]));
        patchRow(row.key, { state: "done", progress: 1 });
        added += 1;
      } catch (err) {
        failed += 1;
        if (err instanceof ImageError) {
          patchRow(row.key, { state: "failed", message: fill(t(`gl.file.${err.code}`), { name: row.name }) });
          continue;
        }
        const message = t(galleryErrorKey(err));
        patchRow(row.key, { state: "failed", message });
        if (err instanceof ApiError && err.code === "EVENT_ARCHIVED") setArchivedEvent(eventId);
        if (stopsBatch(err)) stop = message;
      }
    }
    setUploading(false);
    if (added && failed) toast(fill(t("gl.added_some"), { n: added, failed }), "warning");
    else if (added) toast(fill(t("gl.added"), { n: added }), "success");
    else toast(t("gl.upload_none"), "error");
  };

  const pick = () => {
    if (isDemoApiEnabled()) {
      window.dispatchEvent(new CustomEvent("hackos:demo-write"));
      return;
    }
    inputRef.current?.click();
  };

  /* ── One photo ──────────────────────────────────────────────────────── */

  const saveCaption = async (photo: GalleryPhoto, text: string) => {
    if (activeEventId == null) return;
    const caption = text.trim() ? text.trim().slice(0, MAX_CAPTION) : null;
    if (caption === photo.caption) return;
    try {
      apply(activeEventId, await galleryApi.update(activeEventId, photo.id, { caption }));
      toast(t("gl.caption_saved"), "success");
    } catch (err) {
      fail(err);
    }
  };

  const move = async (photo: GalleryPhoto, dir: -1 | 1) => {
    if (!view || activeEventId == null || moving) return;
    const { order, changes } = reorder(view.items, photo.id, dir);
    if (!changes.length) return;
    const eventId = activeEventId;
    setData({ eventId, view: { ...view, items: order }, error: null });
    // The button moved with its photo; keep the keyboard on it.
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-move="${photo.id}:${dir}"]:not([disabled])`)?.focus();
    });
    setMoving(true);
    try {
      let last: GalleryView | null = null;
      for (const c of changes) last = await galleryApi.update(eventId, c.id, { position: c.position });
      apply(eventId, last);
    } catch (err) {
      fail(err);
      // Show the order the server has.
      try {
        apply(eventId, await galleryApi.get(eventId));
      } catch {
        /* the optimistic order stays until the next refresh */
      }
    } finally {
      setMoving(false);
    }
  };

  const remove = async () => {
    const photo = toDelete;
    setToDelete(null);
    if (!photo || activeEventId == null) return;
    const eventId = activeEventId;
    try {
      await galleryApi.remove(eventId, photo.id);
      toast(t("gl.deleted"), "success");
      try {
        apply(eventId, await galleryApi.get(eventId));
      } catch {
        setData((d) => (d && d.view ? { ...d, view: { ...d.view, items: d.view.items.filter((p) => p.id !== photo.id) } } : d));
      }
    } catch (err) {
      fail(err);
    }
  };

  const photoAlt = (p: GalleryPhoto, i: number) => p.caption || fill(t("gl.photo_alt"), { i: i + 1, event: view?.eventName ?? "" });
  const lightboxPhotos: LightboxPhoto[] = items.map((p, i) => ({ url: p.url, alt: photoAlt(p, i), caption: p.caption, download: true }));

  if (activeEventId == null && !eventLoading) {
    return <p className="py-10 text-center text-[15px]" style={{ color: "var(--ink-3)" }}>{t("gl.no_event")}</p>;
  }

  const doneCount = uploads.filter((u) => u.state === "done" || u.state === "failed" || u.state === "skipped").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("gl.title")}</h1>
          <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("gl.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} className={refreshing ? "animate-spin" : undefined} />} onClick={() => void reload()} disabled={refreshing || loading}>
            {t("gl.refresh")}
          </Button>
          <Button size="sm" variant="primary" icon={<ImagePlus size={14} />} onClick={pick} disabled={loading || !canEdit || room === 0 || uploading}>
            {t("gl.upload")}
          </Button>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          void addFiles(files);
        }}
      />

      {archived ? <Notice tone="warn">{t("gl.archived_note")}</Notice> : null}

      {current?.error === "gl.err.MODULE_DISABLED" ? (
        <Notice tone="warn">{t("gl.err.MODULE_DISABLED")}</Notice>
      ) : current?.error ? (
        <LoadFailure message={t(current.error)} onRetry={() => void reload()} retrying={refreshing} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <Card>
                <CardHeader
                  title={loading ? <Skeleton className="h-4 w-32" /> : fill(t("gl.counter"), { n: items.length, max })}
                  hint={t("gl.upload_hint")}
                />
                <Progress value={loading ? 0 : Math.round((items.length / max) * 100)} tone={room === 0 ? "warn" : "brand"} />
                {canEdit ? (
                  <div
                    className="mt-4 rounded-[12px] border-2 border-dashed px-4 py-6 text-center transition-colors"
                    style={{ borderColor: dragging ? "var(--accent)" : "var(--line-strong)", background: dragging ? "var(--accent-weak)" : "transparent" }}
                    onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      void addFiles(Array.from(e.dataTransfer.files || []));
                    }}
                  >
                    {room === 0 ? (
                      <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>{fill(t("gl.full"), { max })}</p>
                    ) : (
                      <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
                        <Button size="sm" icon={<ImagePlus size={14} />} onClick={pick} disabled={uploading}>{t("gl.upload")}</Button>
                        <span className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("gl.drop_hint")}</span>
                      </div>
                    )}
                  </div>
                ) : null}
                {uploads.length ? (
                  <UploadList rows={uploads} done={doneCount} uploading={uploading} onClear={() => setUploads([])} t={t} />
                ) : null}
              </Card>
            </div>
            <div className="lg:col-span-2">
              <SharePanel view={view} loading={loading} canEdit={canEdit} eventId={activeEventId} onShared={() => void reload()} onError={fail} />
            </div>
          </div>

          <section aria-labelledby="gl-grid-h" className="space-y-3">
            <h2 id="gl-grid-h" className="sr-only">{t("gl.title")}</h2>
            {loading ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-[4/3] w-full rounded-[var(--radius)]" />)}
              </div>
            ) : items.length === 0 ? (
              <Card padded={false}>
                <EmptyState
                  icon={<Images size={19} />}
                  title={t("gl.empty_title")}
                  body={t("gl.empty_body")}
                  action={canEdit ? <Button size="sm" variant="primary" icon={<ImagePlus size={14} />} onClick={pick}>{t("gl.upload")}</Button> : undefined}
                />
              </Card>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {items.map((p, i) => (
                  <li key={p.id}>
                    <PhotoCard
                      photo={p}
                      index={i}
                      total={items.length}
                      alt={photoAlt(p, i)}
                      canEdit={canEdit}
                      moving={moving}
                      onOpen={() => setViewing(i)}
                      onCaption={(text) => void saveCaption(p, text)}
                      onMove={(dir) => void move(p, dir)}
                      onDelete={() => setToDelete(p)}
                      t={t}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <PhotoLightbox
        photos={lightboxPhotos}
        index={viewing}
        onIndex={setViewing}
        onClose={() => setViewing(null)}
        labels={{
          dialog: t("gl.lb.dialog"), close: t("gl.lb.close"), prev: t("gl.lb.prev"), next: t("gl.lb.next"),
          position: t("gl.lb.position"), download: t("gl.lb.download"),
        }}
      />

      <ConfirmDialog
        open={toDelete != null}
        title={t("gl.delete_title")}
        message={t("gl.delete_body")}
        confirmLabel={t("gl.delete")}
        cancelLabel={t("gl.cancel")}
        variant="danger"
        onConfirm={() => void remove()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

/* ── Parts ─────────────────────────────────────────────────────────────── */

function UploadList({ rows, done, uploading, onClear, t }: { rows: UploadRow[]; done: number; uploading: boolean; onClear: () => void; t: T }) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium" style={{ color: "var(--ink)" }} aria-live="polite">
          {uploading ? fill(t("gl.uploading"), { done: Math.min(done + 1, rows.length), total: rows.length }) : t("gl.upload.list")}
        </p>
        <Button size="sm" variant="ghost" onClick={onClear} disabled={uploading}>{t("gl.upload.clear")}</Button>
      </div>
      <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
        {rows.map((r) => (
          <li key={r.key} className="rounded-[10px] border px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <div className="flex items-center gap-2">
              <UploadIcon state={r.state} />
              <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: "var(--ink)" }} title={r.name}>{r.name}</span>
              <span className="shrink-0 text-[12px] tabular-nums" style={{ color: r.state === "failed" || r.state === "skipped" ? "var(--danger)" : "var(--ink-3)" }}>
                {r.state === "uploading" ? fill(t("gl.upload.uploading"), { p: Math.round(r.progress * 100) }) : r.state === "failed" ? "" : t(`gl.upload.${r.state}`)}
              </span>
            </div>
            {r.state === "uploading" ? (
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--tint)" }}>
                <div className="h-full rounded-full" style={{ width: `${Math.round(r.progress * 100)}%`, background: "var(--accent)" }} />
              </div>
            ) : null}
            {r.message ? <p className="mt-1 text-[12px] leading-snug" style={{ color: "var(--danger)" }}>{r.message}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UploadIcon({ state }: { state: UploadState }) {
  if (state === "done") return <CheckCircle2 size={15} aria-hidden="true" style={{ color: "var(--ok)" }} />;
  if (state === "failed" || state === "skipped") return <AlertTriangle size={15} aria-hidden="true" style={{ color: "var(--danger)" }} />;
  if (state === "waiting") return <span aria-hidden="true" className="inline-block h-[15px] w-[15px] rounded-full border" style={{ borderColor: "var(--line-strong)" }} />;
  return <Loader2 size={15} aria-hidden="true" className="animate-spin" style={{ color: "var(--accent)" }} />;
}

function PhotoCard({
  photo, index, total, alt, canEdit, moving, onOpen, onCaption, onMove, onDelete, t,
}: {
  photo: GalleryPhoto;
  index: number;
  total: number;
  alt: string;
  canEdit: boolean;
  moving: boolean;
  onOpen: () => void;
  onCaption: (text: string) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  t: T;
}) {
  // What is typed, until the saved caption changes under it.
  const [draft, setDraft] = useState<{ base: string | null; text: string }>({ base: photo.caption, text: photo.caption ?? "" });
  const text = draft.base === photo.caption ? draft.text : photo.caption ?? "";
  const dirty = text.trim() !== (photo.caption ?? "");
  const captionId = `gl-cap-${photo.id}`;

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
      <div className="relative">
        <button type="button" onClick={onOpen} aria-label={fill(t("gl.lb.open"), { i: index + 1 })} className="block w-full focus-visible:outline-2 focus-visible:outline-offset-[-2px]" style={{ outlineColor: "var(--accent)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt={alt} loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover" style={{ background: "var(--tint)" }} />
        </button>
        <span className="pointer-events-none absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums" style={{ background: "rgba(12,14,18,0.62)", color: "#fff" }}>
          {index + 1}
        </span>
      </div>
      <div className="space-y-2 p-2.5">
        {canEdit ? (
          <div className="flex items-center gap-1.5">
            <label htmlFor={captionId} className="sr-only">{t("gl.caption_label")}</label>
            <input
              id={captionId}
              value={text}
              maxLength={MAX_CAPTION}
              placeholder={t("gl.caption_placeholder")}
              onChange={(e) => setDraft({ base: photo.caption, text: e.target.value })}
              onBlur={() => { if (dirty) onCaption(text); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (dirty) onCaption(text);
                }
              }}
              className="block w-full min-w-0 rounded-[8px] border px-2.5 py-1.5 text-[13px] outline-none transition-[border-color,box-shadow] duration-150 focus:ring-2"
              style={inputStyle()}
            />
            {dirty ? (
              <Button size="sm" variant="ghost" icon={<Check size={14} />} aria-label={t("gl.caption_save")} title={t("gl.caption_save")} onMouseDown={(e) => e.preventDefault()} onClick={() => onCaption(text)} />
            ) : null}
          </div>
        ) : photo.caption ? (
          <p className="line-clamp-2 text-[13px]" style={{ color: "var(--ink-2)" }}>{photo.caption}</p>
        ) : null}
        {canEdit ? (
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant="ghost" icon={<ArrowUp size={14} />} aria-label={t("gl.move_up")} title={t("gl.move_up")} data-move={`${photo.id}:-1`}
              disabled={moving || index === 0} onClick={() => onMove(-1)} />
            <Button size="sm" variant="ghost" icon={<ArrowDown size={14} />} aria-label={t("gl.move_down")} title={t("gl.move_down")} data-move={`${photo.id}:1`}
              disabled={moving || index === total - 1} onClick={() => onMove(1)} />
            <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={t("gl.delete")} title={t("gl.delete")} style={{ color: "var(--danger)" }} onClick={onDelete} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SharePanel({
  view, loading, canEdit, eventId, onShared, onError,
}: {
  view: GalleryView | null;
  loading: boolean;
  canEdit: boolean;
  eventId: number | null;
  onShared: () => void;
  onError: (err: unknown) => void;
}) {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const [chat, setChat] = useState(true);
  const [email, setEmail] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ShareResult | null>(null);

  const slug = view?.eventSlug ?? null;
  const path = slug ? galleryPagePath(slug) : null;
  const empty = (view?.items.length ?? 0) === 0;
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  const reason = !canEdit ? null : empty ? t("gl.share_empty") : !slug ? null : !chat && !email ? t("gl.share_pick") : null;

  const share = async () => {
    if (eventId == null || busy) return;
    setBusy(true);
    try {
      const out = await galleryApi.share(eventId, { chat, email, ...(message.trim() ? { message: message.trim() } : {}) });
      setResult(out);
      // The toast says the best of what happened; the panel lists every channel.
      const reached = shareReached(out);
      const said = reached
        ? shareOutcomeKey(out.chat === "sent" ? "chat" : "email", out.chat === "sent" ? out.chat : out.email)
        : shareOutcomeKey("chat", out.chat) ?? shareOutcomeKey("email", out.email);
      toast(t(said ?? "gl.err.generic"), reached ? "success" : "warning");
      if (reached) onShared();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!path) return;
    const url = result?.link ?? new URL(path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      toast(t("gl.link_copied"), "success");
    } catch {
      toast(url, "info", 12000);
    }
  };

  return (
    <Card>
      <CardHeader title={t("gl.share_title")} hint={t("gl.share_hint")} />
      {loading ? (
        <div className="space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-20 w-full" /></div>
      ) : (
        <div className="space-y-3">
          {!slug ? <Notice tone="warn">{t("gl.no_page")}</Notice> : null}
          <div>
            <Toggle label={t("gl.share_chat")} checked={chat} onChange={setChat} disabled={!canEdit || !slug} compact />
            <Toggle label={t("gl.share_email")} help={t("gl.share_email_help")} checked={email} onChange={setEmail} disabled={!canEdit || !slug} compact />
          </div>
          <TextArea label={t("gl.share_message")} value={message} onChange={setMessage} placeholder={t("gl.share_message_placeholder")} rows={3} maxLength={MAX_MESSAGE} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" icon={<Share2 size={14} />} loading={busy} onClick={() => void share()}
              disabled={busy || !canEdit || !slug || empty || (!chat && !email)}>
              {t("gl.share_button")}
            </Button>
            {reason ? <span className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>{reason}</span> : null}
          </div>

          {result ? (
            <ul className="space-y-1.5" aria-live="polite">
              {(["chat", "email"] as const).map((ch) => {
                const outcome = result[ch];
                const key = shareOutcomeKey(ch, outcome);
                if (!key) return null;
                const good = outcome === "sent" || outcome === "queued";
                return (
                  <li key={ch} className="flex items-start gap-2 text-[13px]" style={{ color: "var(--ink-2)" }}>
                    {good
                      ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden="true" style={{ color: "var(--ok)" }} />
                      : <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" style={{ color: "var(--warn)" }} />}
                    <span>{t(key)}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="space-y-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
            {view?.shared.chatAt || view?.shared.emailAt ? (
              <>
                {view.shared.chatAt ? <p>{fill(t("gl.share_last_chat"), { time: when(view.shared.chatAt) })}</p> : null}
                {view.shared.emailAt ? <p>{fill(t("gl.share_last_email"), { time: when(view.shared.emailAt) })}</p> : null}
              </>
            ) : (
              <p>{t("gl.share_never")}</p>
            )}
          </div>

          {path ? (
            <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--line)" }}>
              <a href={path} target="_blank" rel="noopener noreferrer" {...buttonLook("secondary", "sm")} onClick={demoRefusal}>
                <ExternalLink size={14} aria-hidden="true" />
                {t("gl.members_page")}
              </a>
              <Button size="sm" variant="ghost" icon={<Copy size={14} />} onClick={() => void copy()}>{t("gl.copy_link")}</Button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
