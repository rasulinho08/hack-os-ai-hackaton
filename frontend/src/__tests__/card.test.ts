/**
 * The checkout's card checks: brand, grouping, checksum, expiry, CVC.
 */
import { describe, expect, it } from "vitest";
import {
  cardNumberValid,
  cvcValid,
  detectBrand,
  expiryValid,
  formatCardNumber,
  formatExpiry,
  luhnValid,
} from "@/lib/card";

describe("detectBrand", () => {
  it.each([
    ["4242 4242 4242 4242", "visa"],
    ["5555 5555 5555 4444", "mastercard"],
    ["2223 0031 2200 3222", "mastercard"],
    ["3782 822463 10005", "amex"],
    ["6011 1111 1111 1117", "discover"],
    ["6200 0000 0000 0005", "unionpay"],
    ["3530 1113 3330 0000", "jcb"],
    ["6759 6498 2643 8453", "maestro"],
    ["9999", "other"],
  ])("%s is %s", (n, brand) => {
    expect(detectBrand(n)).toBe(brand);
  });
});

describe("formatCardNumber", () => {
  it("groups in fours", () => {
    expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242");
  });
  it("groups Amex 4-6-5 and stops at 15 digits", () => {
    expect(formatCardNumber("3782822463100059999")).toBe("3782 822463 10005");
  });
  it("ignores everything that is not a digit", () => {
    expect(formatCardNumber("4242-4242 abc 42")).toBe("4242 4242 42");
  });
});

describe("checksum and length", () => {
  it("accepts well-known valid numbers", () => {
    for (const n of ["4242424242424242", "5555555555554444", "378282246310005", "6011111111111117"]) {
      expect(cardNumberValid(n)).toBe(true);
    }
  });
  it("refuses a mistyped digit", () => {
    expect(luhnValid("4242424242424241")).toBe(false);
    expect(cardNumberValid("4242424242424241")).toBe(false);
  });
  it("refuses a valid checksum at the wrong length for the brand", () => {
    expect(cardNumberValid("378282246310005")).toBe(true);
    expect(cardNumberValid("4242424242")).toBe(false);
  });
});

describe("expiry", () => {
  const now = new Date(2026, 9, 18); // 18 Oct 2026
  it("formats while typing", () => {
    expect(formatExpiry("4")).toBe("04");
    expect(formatExpiry("1229")).toBe("12 / 29");
  });
  it("is valid through the end of the month", () => {
    expect(expiryValid("10 / 26", now)).toBe(true);
    expect(expiryValid("09 / 26", now)).toBe(false);
  });
  it("refuses impossible months and far-future years", () => {
    expect(expiryValid("13 / 27", now)).toBe(false);
    expect(expiryValid("01 / 99", now)).toBe(false);
  });
});

describe("cvc", () => {
  it("is four digits on Amex, three elsewhere", () => {
    expect(cvcValid("1234", "amex")).toBe(true);
    expect(cvcValid("123", "amex")).toBe(false);
    expect(cvcValid("123", "visa")).toBe(true);
    expect(cvcValid("12a", "visa")).toBe(false);
  });
});
