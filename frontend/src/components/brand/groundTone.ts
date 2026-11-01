/**
 * Is the surface behind an element dark? The 3D mark asks so it can choose
 * between a soft grey shadow (light grounds) and a faint red glow (dark ones,
 * where a shadow would not show).
 */

/** Parses `rgb()` / `rgba()` as browsers report computed colours; null for anything else. */
export function parseRgb(value: string): { r: number; g: number; b: number; a: number } | null {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(value.trim());
  if (!m) return null;
  let a = 1;
  if (m[4] !== undefined) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { r: +m[1], g: +m[2], b: +m[3], a };
}

/** WCAG relative luminance of an sRGB colour given in 0..255. */
export function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Dark enough that white text would sit on it: the midpoint of black and white contrast. */
export const DARK_LUMINANCE = 0.18;

function toRgb(value: string): { r: number; g: number; b: number; a: number } | null {
  const direct = parseRgb(value);
  if (direct) return direct;
  // oklch(), color() and friends: let a 1×1 canvas resolve them.
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  } catch {
    return null;
  }
}

/** Walks up to the first mostly opaque background and reports whether it is dark. */
export function isOnDarkGround(el: Element | null): boolean {
  for (let node = el; node; node = node.parentElement) {
    const rgb = toRgb(getComputedStyle(node).backgroundColor);
    if (rgb && rgb.a >= 0.5) return relativeLuminance(rgb) < DARK_LUMINANCE;
  }
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
