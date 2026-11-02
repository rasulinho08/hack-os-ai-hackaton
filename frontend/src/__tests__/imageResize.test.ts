/**
 * The arithmetic behind making photos smaller before they are uploaded:
 * the size that fits, when a picture is sent as it is, and its new name.
 */
import { describe, expect, it } from "vitest";
import { ACCEPT_ATTR, MAX_SIDE, fitWithin, isAcceptedImage, needsResize, outputName } from "@/lib/imageResize";

const MB = 1024 * 1024;

describe("fitWithin", () => {
  it("brings the long side down to the limit and keeps the proportions", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(6000, 1000, 1200)).toEqual({ width: 1200, height: 200 });
  });

  it("never makes a picture larger, and never smaller than a pixel", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(MAX_SIDE, 10)).toEqual({ width: MAX_SIDE, height: 10 });
    expect(fitWithin(100000, 1)).toEqual({ width: 2000, height: 1 });
    expect(fitWithin(0, 0)).toEqual({ width: 1, height: 1 });
  });
});

describe("needsResize", () => {
  it("sends a small JPEG, PNG or WebP as it is", () => {
    expect(needsResize({ type: "image/jpeg", size: 900 * 1024, width: 1600, height: 1200 })).toBe(false);
    expect(needsResize({ type: "image/png", size: 200 * 1024, width: 2000, height: 2000 })).toBe(false);
    expect(needsResize({ type: "image/webp", size: 1 * MB, width: 1200, height: 800 })).toBe(false);
  });

  it("redraws what is too wide, too heavy, or in a format the API does not take", () => {
    expect(needsResize({ type: "image/jpeg", size: 400 * 1024, width: 2001, height: 1000 })).toBe(true);
    expect(needsResize({ type: "image/jpeg", size: 3 * MB, width: 1600, height: 1200 })).toBe(true);
    expect(needsResize({ type: "image/heic", size: 300 * 1024, width: 1000, height: 800 })).toBe(true);
    expect(needsResize({ type: "image/gif", size: 10 * 1024, width: 100, height: 100 })).toBe(true);
  });
});

describe("outputName and the accepted types", () => {
  it("keeps the name and gives it the extension of what is sent", () => {
    expect(outputName("IMG_2041.HEIC", "image/jpeg")).toBe("IMG_2041.jpg");
    expect(outputName("logo.png", "image/png")).toBe("logo.png");
    expect(outputName("shot.jpeg", "image/webp")).toBe("shot.webp");
    expect(outputName("", "image/jpeg")).toBe("photo.jpg");
    expect(outputName("my.holiday.photo.jpg", "image/jpeg")).toBe("my.holiday.photo.jpg");
  });

  it("accepts the three formats the API stores, in any letter case", () => {
    expect(isAcceptedImage("image/JPEG")).toBe(true);
    expect(isAcceptedImage("image/svg+xml")).toBe(false);
    expect(ACCEPT_ATTR).toBe("image/jpeg,image/png,image/webp");
  });
});
