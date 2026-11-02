/**
 * The scanner's fallback for browsers without a barcode reader (Safari on
 * iPhone): a frame is scaled down and its QR code decoded with jsQR.
 */
import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { decodeRgba, frameSize } from "@/lib/qrFallback";

// A version 1 QR code holding "HK7Q-4MZP" (made with qrcode-generator, level M).
const TICKET = [
  "#######...#.#.#######", "#.....#.####..#.....#", "#.###.#..#.#..#.###.#", "#.###.#.....#.#.###.#",
  "#.###.#.#.#.#.#.###.#", "#.....#..#..#.#.....#", "#######.#.#.#.#######", "..........###........",
  "#.#.#.#...##....#..#.", "..#.##.#.#...##..###.", "####.##.#...#..###.##", "#####..##........#.#.",
  "#.#.#####.#.####.#...", "........##.#.#.#...#.", "#######...##..####.##", "#.....#....###.#.....",
  "#.###.#.#.##..#####..", "#.###.#...#...#.##.#.", "#.###.#.###.#...###.#", "#.....#...#...#..#.#.",
  "#######.##..#.##...##",
];

/** The code drawn as a camera might see it: `cell` pixels a module, a light border around it. */
function render(rows: string[], cell = 6, quiet = 4, invert = false) {
  const n = rows.length;
  const size = (n + quiet * 2) * cell;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.floor(y / cell) - quiet;
      const c = Math.floor(x / cell) - quiet;
      const dark = r >= 0 && c >= 0 && r < n && c < n && rows[r][c] === "#";
      const v = dark !== invert ? 20 : 235;
      const i = (y * size + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { data, size };
}

describe("QR fallback", () => {
  it("reads a ticket from a frame", () => {
    const { data, size } = render(TICKET);
    expect(decodeRgba(jsQR, data, size, size)).toBe("HK7Q-4MZP");
  });

  it("finds nothing in an empty frame, a light-on-dark code or a short buffer", () => {
    const blank = new Uint8ClampedArray(200 * 200 * 4).fill(235);
    expect(decodeRgba(jsQR, blank, 200, 200)).toBeNull();
    const inverted = render(TICKET, 6, 4, true);
    expect(decodeRgba(jsQR, inverted.data, inverted.size, inverted.size)).toBeNull();
    expect(decodeRgba(jsQR, new Uint8ClampedArray(10), 200, 200)).toBeNull();
    expect(decodeRgba(jsQR, blank, 0, 0)).toBeNull();
  });

  it("decodes frames at most 640 pixels on the long side, keeping their shape", () => {
    expect(frameSize(1920, 1080)).toEqual({ width: 640, height: 360 });
    expect(frameSize(1080, 1920)).toEqual({ width: 360, height: 640 });
    expect(frameSize(480, 360)).toEqual({ width: 480, height: 360 });
    expect(frameSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
});
