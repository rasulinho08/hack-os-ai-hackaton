"use client";

/**
 * Picks an image, makes it the right size in the browser and uploads it.
 *
 * Logos become at most 512 px, banners at most 1600 px wide, saved as WebP
 * where the browser can encode it: a phone photo of several megabytes turns
 * into a few hundred kilobytes before it leaves the device, which keeps the
 * page fast and the organisation's storage for what matters. A signature is
 * kept as PNG: it goes onto certificate PDFs, which cannot hold WebP.
 */

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { uploadFile } from "@/lib/builder/api";
import type { UploadedFile } from "@/lib/builder/types";
import { useTranslation } from "@/contexts/LanguageContext";

async function resize(file: File, maxW: number, maxH: number, pngOnly = false): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    });
    const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    if (!pngOnly) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
      if (blob && blob.type === "image/webp") return blob;
    }
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return png || file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ImageUpload({
  eventId, purpose, url, onUploaded, onRemove, shape = "square", maxW, maxH, label, help,
}: {
  eventId: number;
  purpose: "event_logo" | "event_banner" | "sponsor_logo" | "signature";
  url: string | null;
  onUploaded: (f: UploadedFile) => void;
  onRemove: () => void;
  shape?: "square" | "wide";
  maxW: number;
  maxH: number;
  label: string;
  help?: string;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      setError(t("b.upload.type"));
      return;
    }
    setBusy(true);
    try {
      const blob = await resize(file, maxW, maxH, purpose === "signature");
      const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
      const base = file.name.replace(/\.[a-z0-9]+$/i, "") || "image";
      const uploaded = await uploadFile(eventId, purpose, blob, `${base}.${ext}`);
      onUploaded(uploaded);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("b.upload.failed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[13px] font-medium" style={{ color: "var(--ink)" }}>{label}</p>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void pick(e.dataTransfer.files?.[0]); }}
          className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-dashed transition-colors"
          style={{
            width: shape === "wide" ? "min(100%, 360px)" : 112,
            aspectRatio: shape === "wide" ? "3 / 1" : "1 / 1",
            borderColor: "var(--line-strong)",
            background: "var(--surface-sunken)",
          }}
          aria-label={url ? t("b.upload.replace") : t("b.upload.choose")}
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-1.5 px-3 text-center text-[12px]" style={{ color: "var(--ink-3)" }}>
              <ImagePlus size={20} aria-hidden="true" />
              {t("b.upload.choose")}
            </span>
          )}
          {busy ? (
            <span className="absolute inset-0 flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--surface) 70%, transparent)" }}>
              <Loader2 size={20} className="animate-spin" aria-label={t("b.upload.busy")} />
            </span>
          ) : null}
        </button>
        <div className="min-w-0 space-y-2">
          {help ? <p className="max-w-xs text-[12.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>{help}</p> : null}
          {url ? (
            <button type="button" onClick={onRemove} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium hover:underline" style={{ color: "var(--danger)" }}>
              <Trash2 size={13} aria-hidden="true" /> {t("b.upload.remove")}
            </button>
          ) : null}
        </div>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => void pick(e.target.files?.[0])} />
      {error ? <p role="alert" className="mt-2 text-[12.5px]" style={{ color: "var(--danger)" }}>{error}</p> : null}
    </div>
  );
}
