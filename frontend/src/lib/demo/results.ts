/**
 * Walkthrough answers for results, the big screen, elimination rounds and
 * presentations: the read paths those screens use, from the same sample
 * rows as ./console. `s` is the path without "api"
 * (`/api/events/1/results` → ["events", "1", "results"]); anything not
 * recognised returns undefined.
 *
 * The ranking is worked out the way the API does it (results.service.js):
 * each judge's complete review, weighted points over the most they could
 * give, averaged and out of 100, ties sharing a place, eliminated teams left
 * out. The demo is
 * frozen in judging, so nothing is published yet.
 */

import { DEMO_CRITERIA, DEMO_JUDGES, DEMO_SCORES, DEMO_SUBMISSIONS, DEMO_TEAMS } from "./console";

const round2 = (n: number) => Math.round(n * 100) / 100;

const FEEDBACK = [
  "Clear problem and a working demo — the onboarding flow needs one more pass.",
  "Strong technical core. Spend the pitch on who uses it, not on the stack.",
  "Lovely interface; the data model will not survive real traffic yet.",
] as const;

function demoRanking() {
  const crit = new Map(DEMO_CRITERIA.map((c) => [c.id, { ...c, max: c.max_score || 10, w: c.weight || 1 }]));
  const subByTeam = new Map(DEMO_SUBMISSIONS.map((s) => [s.team_id, s]));
  const teamOfSub = new Map(DEMO_SUBMISSIONS.map((s) => [s.id, s.team_id]));
  const eligible = DEMO_TEAMS.filter((t) => t.status !== "eliminated" && subByTeam.has(t.id));

  // As the API: only a judge's complete review (every criterion) counts.
  type Acc = { points: number; max: number; scores: Map<number, number> };
  const perJudge = new Map<number, Map<number, Acc>>();
  for (const r of DEMO_SCORES) {
    const c = crit.get(r.criterion_id);
    const team = teamOfSub.get(r.submission_id);
    if (!c || team == null) continue;
    if (!perJudge.has(team)) perJudge.set(team, new Map());
    const j = perJudge.get(team) as Map<number, Acc>;
    const acc = j.get(r.judge_id) ?? { points: 0, max: 0, scores: new Map<number, number>() };
    acc.points += r.score * c.w;
    acc.max += c.max * c.w;
    acc.scores.set(c.id, r.score);
    j.set(r.judge_id, acc);
  }

  const base = (t: (typeof DEMO_TEAMS)[number]) => {
    const s = subByTeam.get(t.id);
    return { teamId: t.id, teamName: t.name, projectName: s?.project_name ?? null, submissionId: s?.id ?? null, trackId: null, track: null };
  };
  const ranked: Array<ReturnType<typeof base> & { score: number; judgesCount: number; breakdown: unknown[]; place: number; tie: boolean }> = [];
  const unscored: ReturnType<typeof base>[] = [];
  for (const t of eligible) {
    const complete = [...(perJudge.get(t.id) ?? new Map<number, Acc>()).values()].filter((a) => a.max > 0 && a.scores.size >= DEMO_CRITERIA.length);
    const fractions = complete.map((a) => a.points / a.max);
    if (!fractions.length) { unscored.push(base(t)); continue; }
    ranked.push({
      ...base(t),
      score: round2((fractions.reduce((a, f) => a + f, 0) / fractions.length) * 100),
      judgesCount: fractions.length,
      breakdown: DEMO_CRITERIA.map((c) => {
        const list = complete.map((a) => a.scores.get(c.id)).filter((v): v is number => v != null);
        return { criterionId: c.id, name: c.name, max: c.max_score, weight: c.weight, avg: list.length ? round2(list.reduce((a, v) => a + v, 0) / list.length) : null };
      }),
      place: 0,
      tie: false,
    });
  }
  ranked.sort((a, b) => b.score - a.score || b.judgesCount - a.judgesCount || (a.submissionId ?? 0) - (b.submissionId ?? 0));
  let place = 0;
  ranked.forEach((r, i) => {
    if (i === 0 || r.score !== ranked[i - 1].score) place = i + 1;
    r.place = place;
  });
  for (const r of ranked) r.tie = ranked.some((o) => o !== r && o.place === r.place);
  const eliminated = DEMO_TEAMS.filter((t) => t.status === "eliminated").map(base);
  return { ranked, unscored, eliminated };
}

function demoReviews() {
  const teamOfSub = new Map(DEMO_SUBMISSIONS.map((s) => [s.id, s.team_id]));
  const name = new Map(DEMO_JUDGES.map((j) => [j.id, j.full_name]));
  const out = new Map<string, { teamId: number; judgeId: number; judgeName: string; scores: Record<number, number>; feedback: string | null }>();
  for (const r of DEMO_SCORES) {
    const team = teamOfSub.get(r.submission_id);
    if (team == null) continue;
    const k = `${team}:${r.judge_id}`;
    if (!out.has(k)) {
      const n = out.size;
      out.set(k, { teamId: team, judgeId: r.judge_id, judgeName: name.get(r.judge_id) ?? `#${r.judge_id}`, scores: {}, feedback: n % 4 === 0 ? FEEDBACK[(n / 4) % FEEDBACK.length] : null });
    }
    (out.get(k) as { scores: Record<number, number> }).scores[r.criterion_id] = r.score;
  }
  return [...out.values()];
}

function demoPrizes(ranked: ReturnType<typeof demoRanking>["ranked"]) {
  const special = ranked[4] ?? ranked[0];
  const placePrize = (id: number, position: number, name: string, value: string) => ({
    prize: { id, name, description: null, value, kind: "place", position, trackId: null, manual: false },
    teams: ranked.filter((r) => r.place === position).map((r) => ({ teamId: r.teamId, teamName: r.teamName, projectName: r.projectName, place: r.place })),
  });
  return [
    placePrize(901, 1, "Grand prize", "5 000 AZN"),
    placePrize(902, 2, "Second place", "2 500 AZN"),
    placePrize(903, 3, "Third place", "1 000 AZN"),
    {
      prize: { id: 904, name: "Best design", description: "Chosen by the jury", value: "Design studio visit", kind: "special", position: null, trackId: null, manual: Boolean(special) },
      teams: special ? [{ teamId: special.teamId, teamName: special.teamName, projectName: special.projectName, place: special.place }] : [],
    },
    { prize: { id: 905, name: "Audience award", description: null, value: null, kind: "special", position: null, trackId: null, manual: false }, teams: [] },
  ];
}

function demoRounds() {
  const out = DEMO_TEAMS.filter((t) => t.status === "eliminated");
  return {
    rounds: [{
      id: 1,
      name: "Round 1 — the best 12 go on to the final pitches",
      note: "Decided by the jury after the first demo round.",
      position: 1,
      createdAt: "2026-08-30T19:00:00.000Z",
      teams: out.map((t) => ({ teamId: t.id, teamName: t.name, reason: "Below the cut after the first demo round.", eliminatedAt: "2026-08-30T19:05:00.000Z", members: t.member_count })),
    }],
    outsideRounds: [],
  };
}

/** The switch for the public projects page: closed, as the results are not published yet. */
function demoProjectsPage() {
  const out = new Set(DEMO_TEAMS.filter((t) => t.status === "eliminated").map((t) => t.id));
  const eliminated = DEMO_SUBMISSIONS.filter((s) => out.has(s.team_id)).length;
  return {
    public: false,
    publicSince: null,
    resultsPublished: false,
    eventPublished: true,
    live: false,
    slug: "demo-hackathon-2026",
    projects: { listed: DEMO_SUBMISSIONS.length - eliminated, hidden: 0, eliminated },
  };
}

export function resolveResultsDemo(s: string[]): unknown | undefined {
  if (s[0] !== "events" || s.length < 3) return undefined;
  if (s[2] === "results") {
    if (s[3] === "projects" && s.length === 4) return demoProjectsPage();
    if (s.length !== 3) return undefined;
    const { ranked, unscored, eliminated } = demoRanking();
    return {
      published: null,
      settings: { visibility: "own_and_winners", showScores: false },
      criteria: DEMO_CRITERIA.map((c) => ({ id: c.id, name: c.name, max: c.max_score, weight: c.weight })),
      ranking: ranked,
      unscored,
      eliminated,
      snapshot: null,
      prizes: demoPrizes(ranked),
      reviews: demoReviews(),
    };
  }
  if (s[2] === "elimination") {
    if (s[3] === "rounds" && s.length === 4) return demoRounds();
    if (s[3] === "suggest") {
      // The walkthrough answers as for "keep none": the whole live ranking, then the unscored.
      const { ranked, unscored } = demoRanking();
      return {
        keep: 0,
        eliminate: [
          ...ranked.map((r) => ({ teamId: r.teamId, teamName: r.teamName, place: r.place, score: r.score })),
          ...unscored.map((u) => ({ teamId: u.teamId, teamName: u.teamName, place: null, score: null })),
        ],
        stays: [],
      };
    }
  }
  return undefined;
}
