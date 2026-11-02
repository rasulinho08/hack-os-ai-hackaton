/**
 * Walkthrough answers for the judges page and the judge's portal: the read
 * paths those screens use, from the same sample rows as ./console. `s` is the
 * path without "api" (`/api/events/1/judging/progress` → ["events", "1",
 * "judging", "progress"]); anything not recognised returns undefined, and
 * the general router answers it (the judges list, invites, criteria).
 *
 * The walkthrough judges every team with every judge, one judge declared a
 * conflict, and the scores are the sample scores — so the progress matrix
 * shows what an organiser watches on the day: most reviews done, one judge
 * behind, two projects still untouched.
 */

import { DEMO_CRITERIA, DEMO_JUDGES, DEMO_SCORES, DEMO_SUBMISSIONS, DEMO_TEAMS } from "./console";

/** One judge declared a tie to one team. */
const DEMO_CONFLICT = (() => {
  const judge = DEMO_JUDGES[2];
  const team = DEMO_TEAMS[3];
  return {
    id: 1,
    event_id: judge.event_id,
    judge_id: judge.id,
    team_id: team.id,
    reason: "Mentored this team at a university bootcamp",
    created_at: "2026-08-30T15:10:00.000Z",
    judge_name: judge.full_name,
    team_name: team.name,
    by_judge: true,
  };
})();

function demoProgress() {
  const criteria = DEMO_CRITERIA.length;
  const filled = new Map<string, number>();
  for (const s of DEMO_SCORES) {
    const k = `${s.judge_id}:${s.submission_id}`;
    filled.set(k, (filled.get(k) || 0) + 1);
  }
  const teams = DEMO_SUBMISSIONS.map((sub) => {
    const team = DEMO_TEAMS.find((t) => t.id === sub.team_id);
    return { sub, team, eliminated: team?.status === "eliminated" };
  });
  const cells: { judgeId: number; teamId: number; state: string }[] = [];
  const judgeRows = DEMO_JUDGES.map((j) => {
    let done = 0;
    let partial = 0;
    let assigned = 0;
    for (const { sub, eliminated } of teams) {
      let state: string;
      if (DEMO_CONFLICT.judge_id === j.id && DEMO_CONFLICT.team_id === sub.team_id) state = "conflict";
      else if (eliminated) state = "eliminated";
      else {
        const n = filled.get(`${j.id}:${sub.id}`) || 0;
        state = n === 0 ? "todo" : n < criteria ? "partial" : "done";
        assigned += 1;
        if (state === "done") done += 1;
        if (state === "partial") partial += 1;
      }
      cells.push({ judgeId: j.id, teamId: sub.team_id, state });
    }
    return { id: j.id, userId: j.user_id, name: j.full_name, trackId: null, coiConfirmedAt: null, assigned, done, partial };
  });
  const cellOf = (judgeId: number, teamId: number) => cells.find((c) => c.judgeId === judgeId && c.teamId === teamId)?.state;
  return {
    config: { assignment: "all", judgesPerTeam: 3, blind: false, coiRequired: false },
    // Frozen in judging: closing a few hours from now, as on the day.
    window: { state: "open", start: null, end: new Date(Date.now() + 3 * 3600e3).toISOString() },
    criteria,
    judges: judgeRows,
    teams: teams.map(({ sub, team, eliminated }) => {
      const states = DEMO_JUDGES.map((j) => cellOf(j.id, sub.team_id));
      return {
        id: sub.team_id,
        name: team?.name ?? sub.team_name,
        projectName: sub.project_name,
        submissionId: sub.id,
        eliminated,
        track: null,
        done: states.filter((x) => x === "done").length,
        partial: states.filter((x) => x === "partial").length,
        assigned: states.filter((x) => x === "done" || x === "partial" || x === "todo").length,
      };
    }),
    cells,
  };
}

export function resolveJudgingDemo(s: string[]): unknown | undefined {
  if (s[0] !== "events" || s[2] !== "judging") return undefined;
  switch (s[3]) {
    case "progress":
      return demoProgress();
    case "assignments":
      return {};
    case "conflicts":
      return [DEMO_CONFLICT];
    default:
      return undefined;
  }
}
