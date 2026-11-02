/**
 * People's choice (J1): when the organiser switches it on, admitted
 * participants vote for one project of another team, from the event's start
 * until results are published, and may change or withdraw the vote while it
 * is open. Participants never see counts; the organiser does.
 *
 *   GET    /api/events/:id/voting/me   { enabled, state, opensAt, eligible, candidates, myVote }
 *   POST   /api/events/:id/voting/me   { submissionId }
 *   DELETE /api/events/:id/voting/me
 *   GET    /api/events/:id/voting      organiser: { enabled, state, eligible, voters, tally }
 */

export const VOTING_STATES = ["off", "not_open", "open", "closed", "archived"] as const;
export type VotingState = (typeof VOTING_STATES)[number];

/** Error codes the API answers a vote with; each has words in the "vo.err." keys. */
export const VOTE_ERRORS = [
  "OWN_TEAM", "TEAM_ELIMINATED", "VOTING_CLOSED", "VOTING_NOT_OPEN", "VOTING_OFF", "NOT_PARTICIPANT", "EVENT_ARCHIVED", "NOT_FOUND",
] as const;

export interface Candidate {
  submissionId: number;
  teamId: number;
  teamName: string;
  projectName: string | null;
  description: string | null;
  repoLink: string | null;
  demoLink: string | null;
  videoLink: string | null;
  track: string | null;
}

export interface MyVoting {
  enabled: boolean;
  state: VotingState;
  opensAt: string | null;
  eligible: boolean;
  candidates: Candidate[];
  myVote: number | null;
}

export interface TallyRow {
  submissionId: number;
  teamId: number;
  teamName: string;
  projectName: string | null;
  track: string | null;
  votes: number;
  share: number;
}

export interface Tally {
  enabled: boolean;
  state: VotingState;
  eligible: number;
  voters: number;
  tally: TallyRow[];
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isFinite(n) ? n : null;
};
const state = (v: unknown): VotingState => ((VOTING_STATES as readonly string[]).includes(String(v)) ? (v as VotingState) : "off");
/** Only http(s) links are shown as links. */
const link = (v: unknown): string | null => {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
};

function candidate(v: unknown): Candidate | null {
  const c = obj(v);
  const submissionId = num(c.submissionId);
  if (submissionId == null) return null;
  return {
    submissionId,
    teamId: num(c.teamId) ?? 0,
    teamName: str(c.teamName) ?? "",
    projectName: str(c.projectName),
    description: str(c.description),
    repoLink: link(c.repoLink),
    demoLink: link(c.demoLink),
    videoLink: link(c.videoLink),
    track: str(c.track),
  };
}

export function normalizeMyVoting(v: unknown): MyVoting {
  const r = obj(v);
  const candidates = Array.isArray(r.candidates) ? r.candidates.map(candidate).filter((c): c is Candidate => c !== null) : [];
  return {
    enabled: r.enabled === true,
    state: state(r.state),
    opensAt: str(r.opensAt),
    eligible: r.eligible === true,
    candidates,
    myVote: num(r.myVote),
  };
}

export function normalizeTally(v: unknown): Tally {
  const r = obj(v);
  const rows = Array.isArray(r.tally) ? r.tally : [];
  return {
    enabled: r.enabled === true,
    state: state(r.state),
    eligible: num(r.eligible) ?? 0,
    voters: num(r.voters) ?? 0,
    tally: rows
      .map((x) => {
        const t = obj(x);
        const submissionId = num(t.submissionId);
        if (submissionId == null) return null;
        return {
          submissionId,
          teamId: num(t.teamId) ?? 0,
          teamName: str(t.teamName) ?? "",
          projectName: str(t.projectName),
          track: str(t.track),
          votes: Math.max(0, num(t.votes) ?? 0),
          share: Math.max(0, Math.min(100, num(t.share) ?? 0)),
        };
      })
      .filter((x): x is TallyRow => x !== null),
  };
}

/** The words for an API error code, or null to show the generic message. */
export function voteErrorKey(code: string | null | undefined): string | null {
  return code && (VOTE_ERRORS as readonly string[]).includes(code) ? `vo.err.${code}` : null;
}

/**
 * "Team Beta" for a team called "Beta", but "Team Beta" (not "Team Team
 * Beta") for one already called so, in any of the app's languages.
 */
export function teamCaption(name: string, template: string): string {
  const n = String(name || "").trim();
  if (!n) return "";
  if (/^(team|komanda|команда)(\s|$|[-:–—])/iu.test(n) || /(\s|^)(team|komanda|komandası|команда)$/iu.test(n)) return n;
  return template.split("{team}").join(n);
}
