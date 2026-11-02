/** Azerbaijan mobile: UI default prefix +994, national part up to 9 digits */

export const AZ_PHONE_PREFIX = "+994";

/**
 * Single-field phone: keeps +994 and up to 9 national digits.
 * Accepts pastes like 994501234567 or 0501234567 or 501234567.
 */
export function normalizeAzerbaijanPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return AZ_PHONE_PREFIX;

  let national: string;
  if (digits.startsWith("994")) {
    national = digits.slice(3, 12);
  } else {
    let d = digits;
    if (d.startsWith("0")) d = d.replace(/^0+/, "");
    national = d.slice(0, 9);
  }
  return AZ_PHONE_PREFIX + national;
}

/** Full AZ mobile: 994 + 9-digit national (12 digits total). */
export function isCompleteAzerbaijanPhone(s: string): boolean {
  const d = s.replace(/\D/g, "");
  return d.length === 12 && d.startsWith("994");
}

/** Only country code / empty — phone treated as not filled yet (optional). */
export function isAzerbaijanPhoneEmptyOrPrefixOnly(s: string): boolean {
  const d = s.replace(/\D/g, "");
  return d.length <= 3;
}

/** Age field: digits only, max 3 chars while typing, 0 = empty. */
export function parseAgeInputDigits(raw: string): number {
  const d = raw.replace(/\D/g, "").slice(0, 3);
  if (d === "") return 0;
  const n = parseInt(d, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(120, n);
}

export function formatAgeFieldValue(age: number): string {
  if (!age || age <= 0) return "";
  return String(age);
}

/** Strip spaces for URLs (LinkedIn, GitHub). */
export function sanitizeSocialUrl(raw: string): string {
  return raw.replace(/\s/g, "").trim();
}

/**
 * Normalize a GitHub input (username, `github.com/user`, or full URL) to a
 * full `https://github.com/<user>` URL. Returns "" when input is empty.
 * The backend Zod schema requires `githubLink` to be a valid URL.
 */
export function normalizeGithubUrl(raw: string): string {
  const s = sanitizeSocialUrl(raw);
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  // "github.com/foo" or "www.github.com/foo"
  const stripped = s.replace(/^(www\.)?github\.com\/+/i, "").replace(/^\/+/, "");
  return `https://github.com/${stripped}`;
}

/**
 * Normalize a LinkedIn input (handle, `linkedin.com/in/foo`, or full URL) to
 * a full `https://www.linkedin.com/in/<handle>` URL. Returns "" when empty.
 */
export function normalizeLinkedInUrl(raw: string): string {
  const s = sanitizeSocialUrl(raw);
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  const stripped = s
    .replace(/^(www\.)?linkedin\.com\/+/i, "")
    .replace(/^in\/+/i, "")
    .replace(/^\/+/, "");
  return `https://www.linkedin.com/in/${stripped}`;
}
