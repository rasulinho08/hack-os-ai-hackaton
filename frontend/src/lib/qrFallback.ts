/**
 * Reading QR codes from the camera where the browser has no barcode reader
 * of its own (BarcodeDetector is missing in Safari on iPhone and iPad, and
 * in Firefox). jsQR decodes a frame drawn on a canvas; it is loaded only
 * when the scanner's camera starts on such a browser, so no other page
 * carries it.
 */

/** What the scanner asks of a reader, BarcodeDetector's own shape. */
export interface FrameReader { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> }

type JsQr = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" }) => { data: string } | null;

/**
 * The size a frame is decoded at: the camera's own, scaled down so its long
 * side is at most `max` pixels. A ticket fills much of the frame, and a
 * smaller image decodes several times faster on a phone.
 */
export function frameSize(width: number, height: number, max = 640): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The text of the QR code in an RGBA image, or null when there is none. */
export function decodeRgba(jsQR: JsQr, data: Uint8ClampedArray, width: number, height: number): string | null {
  if (!width || !height || data.length < width * height * 4) return null;
  // Tickets are dark on light: skipping the inverted pass halves the work.
  const found = jsQR(data, width, height, { inversionAttempts: "dontInvert" });
  return found && found.data ? found.data : null;
}

/** A reader that draws the video's current frame and decodes it with jsQR. */
export async function loadJsQrReader(): Promise<FrameReader> {
  const mod = await import("jsqr");
  const jsQR = ((mod as unknown as { default?: JsQr }).default ?? (mod as unknown as JsQr)) as JsQr;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d canvas");
  return {
    async detect(video: HTMLVideoElement) {
      const size = frameSize(video.videoWidth, video.videoHeight);
      if (!size.width) return [];
      if (canvas.width !== size.width) canvas.width = size.width;
      if (canvas.height !== size.height) canvas.height = size.height;
      ctx.drawImage(video, 0, 0, size.width, size.height);
      const image = ctx.getImageData(0, 0, size.width, size.height);
      const text = decodeRgba(jsQR, image.data, size.width, size.height);
      return text ? [{ rawValue: text }] : [];
    },
  };
}
