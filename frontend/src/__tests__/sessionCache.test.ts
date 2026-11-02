/**
 * The middleware's short memory of session checks: one answer per exact set
 * of session cookies, for a few seconds, never past the token's expiry,
 * never for "signed out", and forgotten — and not taken back — on sign-out.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendUser } from "@/lib/backendAuth";
import {
  TTL_MS, cacheSession, checkSessionCached, clearSessionCache, getCachedSession, parseCookies, sessionKey, tokenExpiry,
} from "@/lib/sessionCache";

const ada: BackendUser = { id: 1, role: "hacker", status: "approved", email: "ada@x.test" };
const bob: BackendUser = { id: 2, role: "judge", status: "approved", email: "bob@x.test" };
const jwt = (payload: object) => `h.${btoa(JSON.stringify(payload)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.s`;
const cookies = (token: string, extra = "") => `theme=dark; access_token=${token}${extra}`;

beforeEach(() => clearSessionCache());

describe("keys", () => {
  it("is a hash of the session cookies only, never the token itself", async () => {
    const a = await sessionKey(cookies("tok-a"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("tok-a");
    expect(await sessionKey("theme=light; access_token=tok-a")).toBe(a); // unrelated cookies do not matter
    expect(await sessionKey(cookies("tok-b"))).not.toBe(a); // another session
    expect(await sessionKey(cookies("tok-a", "; hh_event=7"))).not.toBe(a); // another workspace
    expect(await sessionKey(cookies("tok-a", "; hh_elev=x"))).not.toBe(a); // the owner's second step
    expect(await sessionKey("theme=dark")).toBeNull();
  });

  it("reads cookies the way a server does", () => {
    expect(parseCookies("a=1; b=x=y; a=2;  c = 3")).toEqual({ a: "1", b: "x=y", c: "3" });
    expect(parseCookies(null)).toEqual({});
  });
});

describe("remembering", () => {
  it("answers for TTL_MS, then asks again", async () => {
    const key = await sessionKey(cookies("tok-a"));
    cacheSession(key, ada, { now: 1000 });
    expect(getCachedSession(key, 1000 + TTL_MS - 1)).toEqual(ada);
    expect(getCachedSession(key, 1000 + TTL_MS)).toBeNull();
  });

  it("never past the token's own expiry", async () => {
    const token = jwt({ id: 1, exp: 100 });
    expect(tokenExpiry(cookies(token))).toBe(100_000);
    const key = await sessionKey(cookies(token));
    cacheSession(key, ada, { now: 95_000, tokenExp: tokenExpiry(cookies(token)) });
    expect(getCachedSession(key, 99_999)).toEqual(ada);
    expect(getCachedSession(key, 100_000)).toBeNull();
  });

  it("one browser's answer is never another's", async () => {
    const fetch = vi.fn(async (c: string | null) => (c?.includes("tok-a") ? ada : bob));
    expect(await checkSessionCached(cookies("tok-a"), "/hacker", fetch)).toEqual(ada);
    expect(await checkSessionCached(cookies("tok-b"), "/judge", fetch)).toEqual(bob);
    expect(await checkSessionCached(cookies("tok-a"), "/hacker/team", fetch)).toEqual(ada);
    expect(fetch).toHaveBeenCalledTimes(2); // the third came from memory
  });

  it("does not remember 'signed out' or 'API unreachable'", async () => {
    const fetch = vi.fn(async () => null as BackendUser | null | "network");
    await checkSessionCached(cookies("tok-x"), "/hacker", fetch);
    await checkSessionCached(cookies("tok-x"), "/hacker", fetch);
    fetch.mockResolvedValue("network");
    await checkSessionCached(cookies("tok-x"), "/hacker", fetch);
    await checkSessionCached(cookies("tok-x"), "/hacker", fetch);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe("signing out", () => {
  it("forgets this browser's answer and does not take it back", async () => {
    const fetch = vi.fn(async () => ada as BackendUser | null | "network");
    await checkSessionCached(cookies("tok-a"), "/hacker", fetch); // remembered
    await checkSessionCached(cookies("tok-a"), "/api/auth/logout", fetch); // asks, forgets, does not store
    fetch.mockResolvedValue(null);
    expect(await checkSessionCached(cookies("tok-a"), "/hacker", fetch)).toBeNull(); // asked again: signed out
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("sign out everywhere forgets every browser of that account", async () => {
    const fetch = vi.fn(async (c: string | null) => (c?.includes("tok-b") ? bob : ada) as BackendUser | null | "network");
    await checkSessionCached(cookies("tok-a1"), "/hacker", fetch);
    await checkSessionCached(cookies("tok-a2"), "/hacker", fetch); // the same person, another device
    await checkSessionCached(cookies("tok-b"), "/judge", fetch);
    await checkSessionCached(cookies("tok-a1"), "/api/auth/logout-all", fetch);
    const after = vi.fn(async (c: string | null) => (c?.includes("tok-b") ? bob : null) as BackendUser | null | "network");
    expect(await checkSessionCached(cookies("tok-a2"), "/hacker", after)).toBeNull(); // the other device asks again
    expect(await checkSessionCached(cookies("tok-b"), "/judge", after)).toEqual(bob); // someone else stays remembered
    expect(after).toHaveBeenCalledTimes(1);
  });
});
