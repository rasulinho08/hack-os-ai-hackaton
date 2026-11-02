/**
 * An event's archive: whether it is archived, when it will be by itself, and
 * what the ZIP export holds.
 *
 * Published events are archived 14 days after they end (decision E13) and
 * from then on can only be read; the organiser can archive earlier or bring
 * an event back. A draft is never archived by itself, and neither is an event
 * its organiser already brought back once.
 */

export const ARCHIVE_AFTER_DAYS = 14;
const DAY = 86400e3;

/** What the export contains, in the order its README lists it (ar.file.*). */
export const EXPORT_FILES = [
  "event", "participants", "teams", "submissions", "scores", "results",
  "certificates", "announcements", "help", "feedback", "nps", "votes", "files",
] as const;
export type ExportFile = (typeof EXPORT_FILES)[number];

/** The file each entry is saved as, for the list on the page. */
export const EXPORT_FILE_NAMES: Record<ExportFile, string> = {
  event: "event.json",
  participants: "participants.csv",
  teams: "teams.csv",
  submissions: "submissions.csv",
  scores: "scores.csv",
  results: "results.csv",
  certificates: "certificates.csv",
  announcements: "announcements.csv",
  help: "help-requests.csv",
  feedback: "feedback.csv",
  nps: "nps.csv",
  votes: "votes.csv",
  files: "files/",
};

/** How many megabytes of uploaded files one export carries (the API's default). */
export const EXPORT_FILES_MB = 25;

export const exportPath = (eventId: number) => `/api/events/${eventId}/export.zip`;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const date = (v: unknown): Date | null => {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

export function isArchivedEvent(raw: unknown): boolean {
  const e = obj(raw);
  return Boolean(date(e.archived_at ?? e.archivedAt)) || String(e.status ?? "").trim().toLowerCase() === "archived";
}

/** The moment an event ending at `end` is archived by itself. */
export function autoArchiveAt(end: unknown): Date | null {
  const d = date(end);
  return d ? new Date(d.getTime() + ARCHIVE_AFTER_DAYS * DAY) : null;
}

export const ARCHIVE_STAGES = ["archived", "draft", "no_end", "running", "waiting", "due"] as const;
export type ArchiveStage = (typeof ARCHIVE_STAGES)[number];

export interface ArchiveState {
  stage: ArchiveStage;
  archived: boolean;
  archivedAt: string | null;
  endDate: string | null;
  /** When it will be archived by itself (published events with an end date). */
  autoAt: string | null;
  published: boolean;
}

/**
 * Where an event stands:
 *   archived  read-only now
 *   draft     never archived by itself
 *   no_end    published without an end date: nothing to count from
 *   running   not over yet; archived 14 days after the end
 *   waiting   over; archived on autoAt
 *   due       autoAt has passed — the hourly sweep takes it next
 */
export function archiveStateOf(raw: unknown, now = Date.now()): ArchiveState {
  const e = obj(raw);
  const archived = isArchivedEvent(e);
  const archivedAt = date(e.archived_at ?? e.archivedAt);
  const end = date(e.end_date ?? e.endDate);
  const status = String(e.status ?? "").trim().toLowerCase();
  const published = e.is_published === undefined && e.isPublished === undefined ? status !== "draft" : Boolean(e.is_published ?? e.isPublished);
  const auto = published && end ? autoArchiveAt(end) : null;
  let stage: ArchiveStage;
  if (archived) stage = "archived";
  else if (!published) stage = "draft";
  else if (!end) stage = "no_end";
  else if (now < end.getTime()) stage = "running";
  else if (auto && now < auto.getTime()) stage = "waiting";
  else stage = "due";
  return {
    stage,
    archived,
    archivedAt: archivedAt ? archivedAt.toISOString() : null,
    endDate: end ? end.toISOString() : null,
    autoAt: auto ? auto.toISOString() : null,
    published,
  };
}
