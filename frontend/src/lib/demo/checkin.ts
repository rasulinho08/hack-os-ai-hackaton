/**
 * Walkthrough answers for check-in at the door: GET /api/events/:id/checkin
 * (the organisers' list, with its search and filter) and …/checkin/stats.
 * `s` is the path without "api", `path` the whole address with its query;
 * anything else returns undefined.
 *
 * The walkthrough is frozen in judging, so most of the accepted participants
 * came in on Friday morning — scanned at the door by the volunteers, a few
 * checked in by hand at the desk — and a handful never turned up.
 */

import { DEMO_EVENT, DEMO_PARTICIPANTS, DEMO_VOLUNTEERS } from "./console";
import { CODE_ALPHABET, CODE_LENGTH } from "@/lib/checkin";

const ADMITTED = new Set(["approved", "eliminated"]);
const DOOR = DEMO_VOLUNTEERS.slice(0, 2);
const DESK = { id: 1, name: "Demo Organiser" };

/** Park–Miller, as in ./wrapup: the same code on every visit. */
function ticketCode(seed: number): string {
  let x = (seed * 7919) % 2147483647 || 1;
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    x = (x * 48271) % 2147483647;
    out += CODE_ALPHABET[x % CODE_ALPHABET.length];
  }
  return out;
}

function rows() {
  return DEMO_PARTICIPANTS.filter((p) => ADMITTED.has(p.status)).map((p) => {
    const n = p.id - 1000;
    const came = !(n % 7 === 0 || n % 11 === 0);
    const byHand = came && n % 9 === 0;
    const door = DOOR[n % DOOR.length];
    return {
      participantId: p.id,
      name: p.full_name,
      email: p.email,
      team: p.team_name,
      status: p.status,
      checkedIn: came,
      // Friday between 07:50 and 09:30 in Baku.
      checkedInAt: came ? new Date(Date.UTC(2026, 7, 28, 3, 50) + ((n * 37) % 100) * 60_000).toISOString() : null,
      checkedInBy: came ? (byHand ? DESK : { id: door.user_id, name: door.full_name }) : null,
      method: came ? (byHand ? "manual" : "qr") : null,
      code: ticketCode(p.id),
    };
  });
}

type Row = ReturnType<typeof rows>[number];

function counts(all: Row[]) {
  const checkedIn = all.filter((r) => r.checkedIn).length;
  return { admitted: all.length, checkedIn, remaining: all.length - checkedIn };
}

function demoList(query: URLSearchParams) {
  const all = rows();
  const q = (query.get("q") || "").trim().toLowerCase();
  const filter = query.get("filter");
  const limit = Math.min(Math.max(Number.parseInt(query.get("limit") || "", 10) || 50, 1), 200);
  const offset = Math.max(Number.parseInt(query.get("offset") || "", 10) || 0, 0);
  const found = all
    .filter((r) => !q || [r.name, r.email, r.team, r.code].some((v) => String(v ?? "").toLowerCase().includes(q)))
    .filter((r) => (filter === "in" ? r.checkedIn : filter === "out" ? !r.checkedIn : true))
    // Latest arrivals first, those not in yet after them, by name.
    .sort((a, b) => (b.checkedInAt ?? "").localeCompare(a.checkedInAt ?? "") || a.name.localeCompare(b.name));
  return { stats: counts(all), total: found.length, limit, offset, items: found.slice(offset, offset + limit) };
}

export function resolveCheckinDemo(s: string[], path: string): unknown | undefined {
  if (s[0] !== "events" || s[2] !== "checkin" || Number(s[1]) !== DEMO_EVENT.id) return undefined;
  const query = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
  if (s.length === 3) return demoList(query);
  if (s.length === 4 && s[3] === "stats") return { ...counts(rows()), canManage: true };
  return undefined;
}
