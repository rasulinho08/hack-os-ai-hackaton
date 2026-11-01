/**
 * Photos are made smaller in the browser before they are uploaded: the API
 * keeps files in the database with a 5 MB cap per photo, and a phone's
 * camera easily makes 6–12 MB pictures nobody needs at full size on a
 * gallery page. The long side is brought down to 2000 px and the picture
 * saved as JPEG; a PNG with transparent parts stays a PNG.
 *
 * The arithmetic is plain functions (tested); the drawing needs a browser.
 */

export const MAX_SIDE = 2000;
export const JPEG_QUALITY = 0.85;
/** What the API accepts per photo (gallery and story uploads). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** A picture already small in both senses is sent as it is. */
const KEEP_BELOW_BYTES = 1.5 * 1024 * 1024;

export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** For an <input type="file" accept>. */
export const ACCEPT_ATTR = ACCEPTED_TYPES.join(",");

export function isAcceptedImage(type: string): boolean {
  return (ACCEPTED_TYPES as readonly string[]).includes(String(type).toLowerCase());
}

/** The size that fits inside `max` × `max`, keeping the proportions; never larger than the original. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const long = Math.max(w, h);
  if (long <= max) return { width: w, height: h };
  const scale = max / long;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Whether a picture has to be redrawn before it is sent. */
export function needsResize(info: { type: string; size: number; width: number; height: number }, max = MAX_SIDE): boolean {
  if (!isAcceptedImage(info.type)) return true;
  if (Math.max(info.width, info.height) > max) return true;
  return info.size > KEEP_BELOW_BYTES;
}

/** The file name for what is uploaded: same name, the extension of the type it now has. */
export function outputName(name: string, type: string): string {
  const base = String(name || "photo").replace(/\.[A-Za-z0-9]{1,5}$/, "").trim() || "photo";
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return `${base}.${ext}`;
}

export interface PreparedImage {
  blob: Blob;
  name: string;
  type: string;
  width: number;
  height: number;
}

export class ImageError extends Error {
  code: "NOT_AN_IMAGE" | "UNREADABLE" | "TOO_LARGE";
  constructor(code: ImageError["code"], message: string) {
    super(message);
    this.name = "ImageError";
    this.code = code;
  }
}

/* ── In the browser ─────────────────────────────────────────────────────── */

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      // Follows the camera's orientation tag, so portrait photos stay upright.
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall back to an <img> below */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageError("UNREADABLE", "This picture could not be opened.");
  }
}

/** Whether any pixel of a PNG is not fully opaque (checked on a small copy). */
function hasTransparency(source: CanvasImageSource, width: number, height: number): boolean {
  const probe = fitWithin(width, height, 64);
  const c = document.createElement("canvas");
  c.width = probe.width;
  c.height = probe.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(source, 0, 0, probe.width, probe.height);
  const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ImageError("UNREADABLE", "The picture could not be saved."))), type, quality);
  });
}

/**
 * A photo ready to upload: smaller when it needs to be, otherwise as it was.
 * Throws ImageError for files that are not pictures, cannot be read, or are
 * still over the limit afterwards.
 */
export async function prepareImage(file: File, { maxSide = MAX_SIDE, quality = JPEG_QUALITY } = {}): Promise<PreparedImage> {
  const type = String(file.type || "").toLowerCase();
  if (!type.startsWith("image/")) throw new ImageError("NOT_AN_IMAGE", "Only photos can be added (JPEG, PNG or WebP).");
  const img = await decode(file);
  try {
    if (!needsResize({ type, size: file.size, width: img.width, height: img.height }, maxSide)) {
      return { blob: file, name: outputName(file.name, type), type, width: img.width, height: img.height };
    }
    const size = fitWithin(img.width, img.height, maxSide);
    const keepPng = type === "image/png" && hasTransparency(img.source, img.width, img.height);
    const outType = keepPng ? "image/png" : "image/jpeg";
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageError("UNREADABLE", "This browser cannot resize pictures.");
    if (!keepPng) {
      // JPEG has no transparency: put it on white rather than black.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size.width, size.height);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.source, 0, 0, size.width, size.height);
    const blob = await toBlob(canvas, outType, keepPng ? undefined : quality);
    if (blob.size > MAX_UPLOAD_BYTES) throw new ImageError("TOO_LARGE", "This photo is still larger than 5 MB.");
    return { blob, name: outputName(file.name, outType), type: outType, width: size.width, height: size.height };
  } finally {
    img.close();
  }
}
