/**
 * Hacker profile local overlay: when GET /api/auth/me omits fields the user saved,
 * we merge cached values so the UI still shows their last known data.
 */

import {
  normalizeAzerbaijanPhoneInput,
  isAzerbaijanPhoneEmptyOrPrefixOnly,
  isCompleteAzerbaijanPhone,
} from "@/lib/azPhoneAge";
import type { UserProfileNormalized } from "@/lib/userProfileNormalize";

const KEY_PREFIX = "hh_hacker_profile_v1_";

export function hackerProfileCacheKey(userId: number): string {
  return `${KEY_PREFIX}${userId}`;
}

export function readHackerProfileCache(
  userId: number
): Partial<UserProfileNormalized> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(hackerProfileCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Partial<UserProfileNormalized>;
  } catch {
    return null;
  }
}

export function writeHackerProfileCache(user: UserProfileNormalized): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      hackerProfileCacheKey(user.id),
      JSON.stringify(user)
    );
  } catch {
    /* quota / private mode */
  }
}

function emptyStr(v: unknown): boolean {
  return v == null || (typeof v === "string" && !String(v).trim());
}

/**
 * Prefer API when it has real data; fill gaps from cache (e.g. backend not persisting PATCH).
 */
export function mergeHackerProfileWithCache(
  api: UserProfileNormalized,
  cache: Partial<UserProfileNormalized> | null
): UserProfileNormalized {
  if (!cache) return api;
  const out: UserProfileNormalized = { ...api };

  const applyStr = (key: keyof UserProfileNormalized) => {
    const c = cache[key];
    if (typeof c !== "string" || !c.trim()) return;
    const a = out[key];
    if (emptyStr(a)) (out as unknown as Record<string, string>)[key] = c;
  };

  (
    [
      "full_name",
      "first_name",
      "last_name",
      "country",
      "timezone",
      "linkedin",
      "github",
      "university",
      "cohort",
      "dietary",
      "tshirt_size",
      "motivation",
      "how_heard",
      "role",
      "registered_at",
    ] as const
  ).forEach(applyStr);

  if (
    (!out.age || out.age < 14) &&
    typeof cache.age === "number" &&
    cache.age >= 14 &&
    cache.age <= 99
  ) {
    out.age = cache.age;
  }

  const apiPhone = normalizeAzerbaijanPhoneInput(String(out.phone ?? ""));
  const cachePhone = cache.phone
    ? normalizeAzerbaijanPhoneInput(String(cache.phone))
    : "";
  if (cachePhone) {
    if (
      isAzerbaijanPhoneEmptyOrPrefixOnly(apiPhone) ||
      (!isCompleteAzerbaijanPhone(apiPhone) &&
        isCompleteAzerbaijanPhone(cachePhone))
    ) {
      out.phone = cachePhone;
    }
  }

  if (
    (!out.skills || out.skills.length === 0) &&
    Array.isArray(cache.skills) &&
    cache.skills.length > 0
  ) {
    out.skills = [...cache.skills];
  }

  const exp = cache.experience?.trim();
  if (
    exp &&
    (emptyStr(api.experience) ||
      (api.experience === "beginner" && exp !== "beginner"))
  ) {
    out.experience = exp;
  }

  return out;
}
