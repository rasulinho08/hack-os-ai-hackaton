/**
 * Walkthrough answers for certificates, the archive and NPS: the read paths
 * those screens use, from the same sample rows as ./console. `s` is the path
 * without "api" (`/api/events/1/results` → ["events", "1", "results"]);
 * anything not recognised returns undefined.
 *
 * The walkthrough's event is frozen in judging, so the story here is the one
 * an organiser sees on that day: staff and participation certificates out
 * (most e-mailed, one revoked, a team's still to issue), winners waiting for
 * the results — and the recommendation question already answered by the
 * participants who took part.
 */

import {
  DEMO_CRITERIA, DEMO_EVENT, DEMO_JUDGES, DEMO_MENTORS, DEMO_PARTICIPANTS, DEMO_SUBMISSIONS, DEMO_TEAMS, DEMO_VOLUNTEERS,
} from "./console";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A stable XXXX-XXXX-XXXX code per sample certificate. */
function demoCode(seed: number): string {
  // Park–Miller: every product stays below 2^53, so the numbers are exact.
  let x = (seed * 7919) % 2147483647 || 1;
  let out = "";
  for (let i = 0; i < 12; i += 1) {
    x = (x * 48271) % 2147483647;
    out += ALPHABET[x % ALPHABET.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

const at = (day: number, hour: number) => new Date(Date.UTC(2026, 7, day, hour, 0)).toISOString();

interface DemoCert {
  id: number;
  code: string;
  kind: string;
  place: number | null;
  title: string | null;
  name: string;
  email: string;
  teamName: string | null;
  userId: number;
  issuedAt: string;
  emailedAt: string | null;
  revokedAt: string | null;
}

const handedIn = new Set(DEMO_SUBMISSIONS.map((x) => x.team_id));
const liveTeams = DEMO_TEAMS.filter((t) => t.status !== "eliminated" && handedIn.has(t.id));
/** The last team's certificates are still to issue (its project came in late). */
const lateTeam = liveTeams[liveTeams.length - 1];

const members = DEMO_PARTICIPANTS.filter((p) => p.status === "approved" && p.current_team_id != null);

const DEMO_CERTS: DemoCert[] = (() => {
  const rows: DemoCert[] = [];
  let id = 9000;
  const add = (c: Omit<DemoCert, "id" | "code">) => {
    id += 1;
    rows.push({ id, code: demoCode(id), ...c });
  };
  for (const p of members) {
    const team = DEMO_TEAMS.find((t) => t.id === p.current_team_id);
    if (!team || !liveTeams.includes(team) || team === lateTeam) continue;
    add({
      kind: "participation", place: null, title: null, name: p.full_name, email: p.email, teamName: team.name, userId: p.user_id,
      issuedAt: at(31, 15), emailedAt: p.id % 17 === 0 ? null : at(31, 15), revokedAt: p.id === members[5]?.id ? at(31, 18) : null,
    });
  }
  for (const j of DEMO_JUDGES) {
    add({ kind: "judge", place: null, title: null, name: j.full_name, email: j.email, teamName: null, userId: j.user_id, issuedAt: at(31, 15), emailedAt: at(31, 15), revokedAt: null });
  }
  for (const m of DEMO_MENTORS) {
    add({ kind: "mentor", place: null, title: null, name: m.full_name, email: m.email, teamName: null, userId: m.user_id, issuedAt: at(31, 15), emailedAt: at(31, 15), revokedAt: null });
  }
  for (const v of DEMO_VOLUNTEERS) {
    add({ kind: "volunteer", place: null, title: null, name: v.full_name, email: v.email, teamName: null, userId: v.user_id, issuedAt: at(31, 15), emailedAt: at(31, 16), revokedAt: null });
  }
  return rows;
})();

function demoPlan() {
  const issued = DEMO_CERTS.map((c) => ({
    kind: c.kind, userId: c.userId, name: c.name, teamName: c.teamName, place: c.place, title: c.title,
    state: c.revokedAt ? "revoked" : "issued",
  }));
  const fresh = members
    .filter((p) => lateTeam && p.current_team_id === lateTeam.id)
    .map((p) => ({ kind: "participation", userId: p.user_id, name: p.full_name, teamName: lateTeam.name, place: null, title: null, state: "new" }));
  const items = [...issued, ...fresh];
  const byKind: Record<string, { total: number; new: number }> = {};
  for (const it of items) {
    byKind[it.kind] = byKind[it.kind] || { total: 0, new: 0 };
    byKind[it.kind].total += 1;
    if (it.state === "new") byKind[it.kind].new += 1;
  }
  return {
    kinds: ["participation", "winner", "special", "judge", "mentor", "volunteer"],
    needsResults: true,
    items,
    byKind,
    toIssue: fresh.length,
  };
}

const NPS_DISTRIBUTION = [1, 0, 1, 2, 1, 3, 4, 9, 14, 21, 18];
const NPS_COMMENTS = [
  { score: 10, comment: "Best organised hackathon I have been to — the help queue was a lifesaver.", h: 19 },
  { score: 9, comment: "Great mentors and a fair judging process. Would come again.", h: 18 },
  { score: 6, comment: "Fun weekend, but the Wi-Fi kept dropping on Saturday night.", h: 17 },
  { score: 8, comment: "Loved the format. More time for the demo would make it a 10.", h: 16 },
  { score: 10, comment: "Our team met through the lobby and we are still building the project.", h: 15 },
  { score: 3, comment: "The venue was too cold and the schedule changed twice without notice.", h: 14 },
  { score: 9, comment: "Clear rules, quick answers from the organisers.", h: 13 },
];

function demoNps() {
  const responses = NPS_DISTRIBUTION.reduce((s, n) => s + n, 0);
  const promoters = NPS_DISTRIBUTION[9] + NPS_DISTRIBUTION[10];
  const detractors = NPS_DISTRIBUTION.slice(0, 7).reduce((s, n) => s + n, 0);
  const eligible = DEMO_PARTICIPANTS.filter((p) => p.status === "approved").length;
  const sum = NPS_DISTRIBUTION.reduce((s, n, i) => s + n * i, 0);
  return {
    responses,
    eligible,
    responseRate: Math.round((responses / eligible) * 100),
    promoters,
    passives: responses - promoters - detractors,
    detractors,
    score: Math.round(((promoters - detractors) / responses) * 100),
    average: Math.round((sum / responses) * 10) / 10,
    distribution: NPS_DISTRIBUTION,
    comments: NPS_COMMENTS.map((c) => ({ score: c.score, comment: c.comment, at: at(31, c.h) })),
  };
}

/** The builder's answer, as far as the walkthrough's screens read it. */
function demoBuilder() {
  return {
    event: {
      ...DEMO_EVENT,
      slug: "demo-hackathon-2026",
      is_published: true,
      archived_at: null,
      results_published_at: null,
      timezone: "Asia/Baku",
      certificate_config: {
        types: ["participation", "winners", "special", "judge", "mentor", "volunteer"],
        signerName: "Leyla Həsənova",
        signerTitle: "Programme director",
        signatureFileId: null,
        issueAfterResults: true,
      },
    },
    fields: [],
    tracks: [],
    prizes: [],
    sponsors: [],
    criteria: DEMO_CRITERIA,
    staff: { judges: [], mentors: [], volunteers: [], invites: [] },
    resources: [],
    plan: null,
    modules: [],
    limits: { participants: null, storageGb: null },
    checklist: [],
    ready: true,
    capacity: null,
    refs: [],
  };
}

export function resolveWrapupDemo(s: string[]): unknown | undefined {
  if (s[0] !== "events" || s.length < 3) return undefined;
  if (s[2] === "certificates") {
    if (s.length === 3) return DEMO_CERTS;
    if (s[3] === "plan") return demoPlan();
    return undefined;
  }
  if (s[2] === "feedback" && s[3] === "nps") {
    if (s.length === 4) return demoNps();
    // The organiser's walkthrough is not a participant.
    if (s[4] === "mine") return { eligible: false, open: false, closed: false, opensAt: DEMO_EVENT.end_date, answer: null };
  }
  if (s[2] === "builder" && s.length === 3) return demoBuilder();
  return undefined;
}
