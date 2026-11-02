import { describe, expect, it } from "vitest";
import { numberFormatter } from "@/lib/i18n/numbers";

/* Azerbaijani is written by hand: Chromium's ICU has no Azerbaijani number data. */
describe("numberFormatter", () => {
  it("groups thousands with a dot in Azerbaijani, whatever the browser's ICU has", () => {
    const az = numberFormatter("az");
    expect(az.format(1664)).toBe("1.664");
    expect(az.format(1234567)).toBe("1.234.567");
    expect(az.format(48)).toBe("48");
    expect(az.format(0)).toBe("0");
  });

  it("writes Azerbaijani decimals with a comma", () => {
    expect(numberFormatter("az", { maximumFractionDigits: 1 }).format(1234.5)).toBe("1.234,5");
  });

  it("leaves English and Russian to Intl", () => {
    expect(numberFormatter("en").format(1664)).toBe("1,664");
    expect(numberFormatter("ru").format(1664)).toMatch(/^1\s664$/u);
    // Anything else reads as English.
    expect(numberFormatter("de").format(1664)).toBe("1,664");
  });
});
