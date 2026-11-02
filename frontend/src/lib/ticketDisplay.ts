/** API may return mentor as a string or as a nested user object. */

/** Scalar or nested `{ name, title, ... }` — never pass raw objects to JSX text nodes. */
export function safeDisplayText(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    if (typeof o.name === "string") return o.name;
    if (typeof o.full_name === "string") return o.full_name;
    if (typeof o.title === "string") return o.title;
    if (typeof o.label === "string") return o.label;
    if (typeof o.email === "string") return o.email;
  }
  return "—";
}

/** `members` may be a count (number) or an array of user objects — do not render the array in JSX. */
export function formatMemberCount(members: unknown): number {
  if (typeof members === "number" && !Number.isNaN(members)) return members;
  if (Array.isArray(members)) return members.length;
  return 0;
}

export function formatMentorLabel(mentor: unknown): string {
  if (mentor == null || mentor === "") return "—";
  if (typeof mentor === "string") return mentor;
  if (typeof mentor === "object" && mentor !== null) {
    const m = mentor as {
      name?: string;
      full_name?: string;
      email?: string;
    };
    return m.name ?? m.full_name ?? m.email ?? "—";
  }
  return String(mentor);
}

export function mentorIdFromTicketField(mentor: unknown): number | undefined {
  if (mentor && typeof mentor === "object" && "id" in mentor) {
    const id = (mentor as { id: unknown }).id;
    return typeof id === "number" ? id : undefined;
  }
  return undefined;
}

/** Raw API ticket row — field names vary by backend. */
export type ApiTicketRow = Record<string, unknown> & { id: number };

/**
 * `apiGet` unwraps `{ data }`; some backends may nest arrays — normalize to a list of rows.
 */
export function parseTicketsFromApiResponse(raw: unknown): ApiTicketRow[] {
  const asRows = (arr: unknown[]): ApiTicketRow[] =>
    arr
      .map((r) => {
        if (!r || typeof r !== "object") return null;
        const o = r as Record<string, unknown>;
        const id = Number(o.id);
        if (!Number.isFinite(id)) return null;
        return { ...o, id } as ApiTicketRow;
      })
      .filter((x): x is ApiTicketRow => x != null);

  if (Array.isArray(raw)) return asRows(raw);
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const inner = o.tickets ?? o.items ?? o.rows;
    if (Array.isArray(inner)) return asRows(inner);
  }
  return [];
}

/**
 * Map backend statuses (e.g. in-progress, pending) to UI buckets used for filters & colors.
 */
export function normalizeTicketStatus(raw: unknown): "open" | "claimed" | "resolved" {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");

  if (
    s === "open" ||
    s === "pending" ||
    s === "new" ||
    s === "queued" ||
    s === ""
  ) {
    return "open";
  }
  if (
    s === "claimed" ||
    s === "in-progress" ||
    s === "inprogress" ||
    s === "active" ||
    s === "assigned" ||
    s === "working"
  ) {
    return "claimed";
  }
  if (
    s === "resolved" ||
    s === "closed" ||
    s === "done" ||
    s === "completed" ||
    s === "complete"
  ) {
    return "resolved";
  }
  return "open";
}

export function ticketStatusBadgeLabel(
  canonical: "open" | "claimed" | "resolved",
  t?: (key: string) => string,
): string {
  if (t) {
    if (canonical === "open") return t("ticket.status.open");
    if (canonical === "claimed") return t("ticket.status.in_progress");
    return t("ticket.status.resolved");
  }
  if (canonical === "open") return "Open";
  if (canonical === "claimed") return "In progress";
  return "Resolved";
}

export function ticketFieldTeam(raw: ApiTicketRow): string {
  const nestedTeam =
    raw.team && typeof raw.team === "object"
      ? (raw.team as Record<string, unknown>)
      : null;
  const candidates: unknown[] = [
    raw.team,
    raw.teamName,
    raw.team_name,
    raw.group_name,
    raw.squad,
    nestedTeam?.name,
  ];
  for (const c of candidates) {
    const s = safeDisplayText(c);
    if (s !== "—") return s;
  }
  return "—";
}

export function ticketFieldIssue(raw: ApiTicketRow): string {
  const candidates: unknown[] = [
    raw.issue,
    raw.topic,
    raw.description,
    raw.title,
    raw.summary,
    raw.message,
    raw.subject,
    raw.body,
    raw.content,
    raw.notes,
    raw.detail,
  ];
  for (const c of candidates) {
    const s = safeDisplayText(c);
    if (s !== "—") return s;
  }
  return "—";
}

/** Mentor label from varying API field names. */
export function ticketFieldMentor(raw: ApiTicketRow): string {
  return formatMentorLabel(
    raw.mentor ?? raw.mentor_name ?? raw.mentorName ?? raw.assignee
  );
}

export function ticketFieldCreated(raw: ApiTicketRow): string {
  const candidates: unknown[] = [
    raw.created,
    raw.created_at,
    raw.createdAt,
    raw.updated_at,
    raw.updatedAt,
  ];
  for (const c of candidates) {
    if (c == null || c === "") continue;
    const d = new Date(c as string | number);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    }
    if (typeof c === "string") return c;
  }
  return "—";
}

/**
 * True when the ticket belongs to an event that has already ended.
 *
 * Nothing ever closes a ticket when its hackathon finishes, so the live
 * database still carries tickets sitting at `open` on an event that ended
 * three months ago. They stay exactly as they are — the queue just says so,
 * instead of showing them as if a mentor could still walk over to the table.
 */
export function isTicketFromFinishedEvent(raw: ApiTicketRow): boolean {
  const flag = raw.event_finished ?? raw.eventFinished;
  if (typeof flag === "boolean") return flag;
  if (typeof flag === "string") return flag.toLowerCase() === "true";
  return false;
}
