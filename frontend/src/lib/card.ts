/**
 * Card number handling for the checkout form, all of it in the browser.
 *
 * No payment provider is connected yet, so the checkout only checks that a
 * card looks valid and sends the brand and the last four digits. The full
 * number and the security code never leave this tab: nothing here builds a
 * request, and the checkout page drops them as soon as the order is placed.
 */

export type CardBrand = "visa" | "mastercard" | "amex" | "maestro" | "unionpay" | "discover" | "jcb" | "other";

const BRANDS: { brand: CardBrand; test: RegExp; lengths: number[]; groups: number[]; cvc: number }[] = [
  { brand: "amex", test: /^3[47]/, lengths: [15], groups: [4, 6, 5], cvc: 4 },
  { brand: "visa", test: /^4/, lengths: [13, 16, 19], groups: [4, 4, 4, 4, 3], cvc: 3 },
  { brand: "mastercard", test: /^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/, lengths: [16], groups: [4, 4, 4, 4], cvc: 3 },
  { brand: "discover", test: /^(6011|65|64[4-9])/, lengths: [16, 17, 18, 19], groups: [4, 4, 4, 4, 3], cvc: 3 },
  { brand: "unionpay", test: /^62/, lengths: [16, 17, 18, 19], groups: [4, 4, 4, 4, 3], cvc: 3 },
  { brand: "jcb", test: /^35(2[89]|[3-8])/, lengths: [16, 17, 18, 19], groups: [4, 4, 4, 4, 3], cvc: 3 },
  { brand: "maestro", test: /^(5018|5020|5038|5[06-9]|6\d)/, lengths: [12, 13, 14, 15, 16, 17, 18, 19], groups: [4, 4, 4, 4, 3], cvc: 3 },
];

const OTHER = { brand: "other" as CardBrand, lengths: [12, 13, 14, 15, 16, 17, 18, 19], groups: [4, 4, 4, 4, 3], cvc: 3 };

export const digitsOnly = (value: string) => value.replace(/\D/g, "");

function specOf(digits: string) {
  return BRANDS.find((b) => b.test.test(digits)) ?? OTHER;
}

export function detectBrand(value: string): CardBrand {
  const d = digitsOnly(value);
  return d ? specOf(d).brand : "other";
}

/** "4242424242424242" → "4242 4242 4242 4242"; Amex as 4-6-5. Capped at the brand's longest length. */
export function formatCardNumber(value: string): string {
  const spec = specOf(digitsOnly(value));
  const d = digitsOnly(value).slice(0, Math.max(...spec.lengths));
  const out: string[] = [];
  let i = 0;
  for (const size of spec.groups) {
    if (i >= d.length) break;
    out.push(d.slice(i, i + size));
    i += size;
  }
  if (i < d.length) out.push(d.slice(i));
  return out.join(" ");
}

/** The Luhn checksum every card number carries. */
export function luhnValid(value: string): boolean {
  const d = digitsOnly(value);
  if (d.length < 12) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i -= 1) {
    let n = d.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

export function cardNumberValid(value: string): boolean {
  const d = digitsOnly(value);
  return specOf(d).lengths.includes(d.length) && luhnValid(d);
}

/** "0429" or "04/29" → "04 / 29" while typing. */
export function formatExpiry(value: string): string {
  let d = digitsOnly(value).slice(0, 4);
  if (d.length === 1 && Number(d) > 1) d = `0${d}`;
  return d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d;
}

/** A card valid through the end of its expiry month, not past it, not decades away. */
export function expiryValid(value: string, now = new Date()): boolean {
  const d = digitsOnly(value);
  if (d.length !== 4) return false;
  const month = Number(d.slice(0, 2));
  const year = 2000 + Number(d.slice(2));
  if (month < 1 || month > 12) return false;
  const endOfMonth = new Date(year, month, 1);
  return endOfMonth > now && year <= now.getFullYear() + 20;
}

export const cvcLength = (brand: CardBrand) => (brand === "amex" ? 4 : 3);

export function cvcValid(value: string, brand: CardBrand): boolean {
  return new RegExp(`^\\d{${cvcLength(brand)}}$`).test(value);
}

export const BRAND_LABEL: Record<CardBrand, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  maestro: "Maestro",
  unionpay: "UnionPay",
  discover: "Discover",
  jcb: "JCB",
  other: "Card",
};
