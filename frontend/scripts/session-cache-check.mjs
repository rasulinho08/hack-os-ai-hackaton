#!/usr/bin/env node
/**
 * End-to-end check of the middleware's session memory (src/lib/sessionCache.ts)
 * against a running web app and API:
 *
 *   1. a signed-in participant opens /hacker twice: both answered (the second
 *      from the middleware's memory);
 *   2. they sign out everywhere through the web app;
 *   3. the old cookie opens /hacker again: the middleware must send it to the
 *      sign-in page at once — the remembered "signed in" answer was
 *      forgotten — not let it through for the rest of the memory's 15
 *      seconds (the page layout would catch it later, without ?next=).
 *
 *   WEB_URL=http://localhost:3503 API_URL=http://localhost:5503 \
 *   ADMIN_EMAIL=admin@test.com EVENT_SLUG=<an open event> node scripts/session-cache-check.mjs
 *
 * Creates one participant account in that event. Never point it at production.
 */

const WEB = (process.env.WEB_URL || "http://localhost:3000").replace(/\/+$/, "");
const API = (process.env.API_URL || "http://localhost:5000").replace(/\/+$/, "");
const PASSWORD = "Test1234!";
const slug = process.env.EVENT_SLUG;
if (!slug) throw new Error("EVENT_SLUG is required");

/** A cookie jar per browser. */
function jar() {
  const cookies = new Map();
  return {
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    store(res) {
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const [pair, ...attrs] = line.split(";");
        const i = pair.indexOf("=");
        const name = pair.slice(0, i).trim();
        const value = pair.slice(i + 1).trim();
        if (!value || attrs.some((a) => /max-age=0/i.test(a) || /expires=Thu, 01 Jan 1970/i.test(a))) cookies.delete(name);
        else cookies.set(name, value);
      }
    },
    snapshot: () => new Map(cookies),
    restore(m) { cookies.clear(); for (const [k, v] of m) cookies.set(k, v); },
  };
}
async function call(base, j, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(j.header() ? { Cookie: j.header() } : {}), Origin: base },
    body: body ? JSON.stringify(body) : undefined,
  });
  j.store(res);
  return res;
}
const ok = (cond, msg) => { if (!cond) { console.error(`FAIL ${msg}`); process.exit(1); } console.log(`ok   ${msg}`); };

const run = Date.now().toString(36);
const email = `cache-check.${run}@e2e.test`;
const person = jar();
const admin = jar();

let r = await call(API, person, "POST", `/api/public/events/${slug}/register`, {
  account: { fullName: "Cache Check", email, password: PASSWORD }, entry: { type: "solo" }, answers: {}, accept: { rules: true, coc: true },
});
ok(r.status === 201, `registered a participant (${r.status})`);
const reg = (await r.json()).data;
r = await call(API, admin, "POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL || "admin@test.com", password: PASSWORD });
ok(r.status === 200, "organiser signed in");
const participants = (await (await call(API, admin, "GET", `/api/events/${reg.event.id}/participants`)).json()).data;
const row = (Array.isArray(participants) ? participants : participants?.items || []).find((p) => String(p.email).toLowerCase() === email);
r = await call(API, admin, "PATCH", `/api/events/${reg.event.id}/participants/${row.id}`, { status: "approved" });
ok(r.status === 200, "participant approved");

r = await call(WEB, person, "POST", "/api/auth/login", { email, password: PASSWORD });
ok(r.status === 200, "signed in through the web app");
const before = person.snapshot();

r = await call(WEB, person, "GET", "/hacker");
ok(r.status === 200, `/hacker opens (${r.status})`);
r = await call(WEB, person, "GET", "/hacker");
ok(r.status === 200, `/hacker opens again, from the middleware's memory (${r.status})`);

r = await call(WEB, person, "POST", "/api/auth/logout-all", {});
ok(r.status === 200, `signed out everywhere (${r.status})`);

// The same browser cookie as before signing out (a copied cookie, another tab that kept it).
person.restore(before);
const t0 = Date.now();
r = await call(WEB, person, "GET", "/hacker");
const where = r.headers.get("location") || "";
// The middleware itself must refuse it (its redirect carries ?next=); the page
// layout behind it would also send the person away, but only after the
// middleware had let a forgotten session through from its memory.
ok(r.status === 307 && where.startsWith("/login?next="), `the middleware sends the old cookie to sign in at once (${r.status} → ${where}, ${Date.now() - t0} ms)`);
r = await call(WEB, person, "GET", "/api/teams/mine");
ok(r.status === 401, `and the API refuses it through the web app (${r.status})`);
console.log("session cache check passed");
