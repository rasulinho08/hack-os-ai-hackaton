/**
 * Event Staff (Mentors / Judges) helper
 *
 * Backend flow:
 *   1. Admin creates an event_invite row (email + role). Role = 'mentor' | 'judge' | 'hacker'.
 *   2. When the invited user registers with that email + event, backend auto:
 *      - sets user.role from invite
 *      - marks invite as used
 *      - inserts into `mentor_assignments` or `judges` table
 *   3. Admin can also assign a user directly if they already exist — backend
 *      resolves `userId | email` via resolveUserIdFromBody.
 *
 * This helper unifies add/list/remove so UI can:
 *   - invite-by-email (works before user registers) AND
 *   - direct-assign (works if user already registered).
 */
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/api";

export type StaffRole = "mentor" | "judge" | "volunteer";

export interface StaffInviteRow {
  id: number;
  event_id: number;
  email: string;
  role: "mentor" | "judge" | "hacker" | "volunteer";
  used_at: string | null;
  user_id: number | null;
  created_at: string;
}

export interface StaffAssignmentRow {
  /** judges.id OR mentor_assignments.id OR volunteers.id */
  id: number;
  event_id: number;
  user_id: number;
  full_name: string;
  email: string;
  /** Mentor-only */
  expertise?: string | null;
  /** Mentor-only */
  availability?: string | null;
  /** Volunteer-only — admin-supplied task notes (backend field). */
  assigned_tasks?: string | null;
  created_at?: string;
}

/** Unified view row used by dashboard UIs. */
export interface StaffRow {
  /**
   * Stable key for React:
   *   - assigned: `a:{assignment_id}`
   *   - pending invite: `i:{invite_id}`
   */
  key: string;
  assignmentId: number | null;
  inviteId: number | null;
  email: string;
  name: string;
  status: "pending" | "active";
  expertise: string;
  availability: string;
}

function assignmentEndpoint(eventId: number | string, role: StaffRole) {
  if (role === "mentor") return `/api/events/${eventId}/mentors`;
  if (role === "judge") return `/api/events/${eventId}/judging/judges`;
  return `/api/events/${eventId}/volunteers`;
}

/**
 * Build the personal invite URL the admin must share so the backend receives
 * `eventId` + `email` and can match the event_invites row (otherwise the
 * invitee is created as a generic hacker even if an invite exists).
 */
export function buildStaffInviteUrl(
  eventId: number | string,
  email: string,
  origin?: string
): string {
  const base =
    origin ??
    (typeof window !== "undefined" ? window.location.origin : "");
  if (!base) return "";
  const u = new URL(`${base}/login`);
  u.searchParams.set("eventId", String(eventId));
  u.searchParams.set("register", "1");
  u.searchParams.set("email", email.trim().toLowerCase());
  return u.toString();
}

/* ────────────────────────────────────────────────────────────────────────── */
/* List                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Load combined list: active (registered + assigned) + pending invites.
 * Pending invites are event_invites rows where used_at IS NULL and role matches.
 */
export async function listEventStaff(
  eventId: number | string,
  role: StaffRole
): Promise<StaffRow[]> {
  /*
   * The assignments call is the actual roster, so its failure has to reach the
   * caller: swallowing it into an empty array meant the judges and mentors
   * pages could never tell a broken request from an empty event, and showed
   * "No judges yet" to an organiser whose API was down.
   *
   * Pending invites are supplementary — a failure there should not hide the
   * roster that did load, so that one is still absorbed.
   */
  const [assignments, invites] = await Promise.all([
    apiGet<StaffAssignmentRow[]>(assignmentEndpoint(eventId, role)),
    apiGet<StaffInviteRow[]>(`/api/events/${eventId}/invites`).catch(
      () => [] as StaffInviteRow[]
    ),
  ]);

  const rows: StaffRow[] = [];
  const activeEmails = new Set<string>();

  for (const a of assignments ?? []) {
    const email = (a.email || "").toLowerCase();
    if (email) activeEmails.add(email);
    // Volunteer rows store task notes in `assigned_tasks`; mentors use
    // `expertise`. Surface either through the unified `expertise` field so
    // existing UIs (admin "Tasks/Expertise" column) render for both roles.
    const expertiseUnified =
      (role === "volunteer" ? a.assigned_tasks : a.expertise) ?? "";
    rows.push({
      key: `a:${a.id}`,
      assignmentId: a.id,
      inviteId: null,
      email,
      name: a.full_name || email,
      status: "active",
      expertise: expertiseUnified,
      availability: a.availability ?? "",
    });
  }

  for (const inv of invites ?? []) {
    if (inv.role !== role) continue;
    const email = (inv.email || "").toLowerCase();
    if (!email || activeEmails.has(email)) continue;
    // Surface every invite that doesn't yet have a matching assignment.
    // This includes invites with `used_at != NULL` — those mean the user
    // registered but the auto-assignment side-effect didn't land (e.g.
    // they registered through a different path, or the insert raced).
    // Treating them as "pending" lets admins click Activate and complete
    // the assignment in one call (backend resolves the user by email).
    rows.push({
      key: `i:${inv.id}`,
      assignmentId: null,
      inviteId: inv.id,
      email,
      name: email,
      status: "pending",
      expertise: "",
      availability: "",
    });
  }

  return rows;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Add                                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

export interface AddStaffInput {
  email: string;
  /** Mentor-only extras, ignored for judges. */
  expertise?: string;
  availability?: string;
  /**
   * When `true`, also call the role's direct-assign endpoint so the
   * person becomes Active immediately if they already have an account
   * (e.g. they were a judge in a previous event). Defaults to `false`
   * — admins should opt in via "Confirm assignment" / "Make active"
   * after the invite is created. This stops people who happen to share
   * an email with a previous-event judge from showing up as
   * auto-active in a fresh event (problem 12).
   */
  assignImmediately?: boolean;
}

export interface AddStaffResult {
  invited: boolean;
  assigned: boolean;
  /** Warning if both invite+assign failed (rare). */
  error?: string;
}

/**
 * Add a mentor/judge:
 *   1. Always create an event_invites row (role=mentor|judge). On
 *      registration the user is auto-assigned to *this* event only.
 *   2. ONLY when the admin explicitly asks (assignImmediately) do we
 *      also call the direct assignment endpoint to flip the row to
 *      "Active" right away for users who already have an account.
 *
 * Behaviour change vs. the previous version: the auto direct-assign
 * has been gated behind `assignImmediately`. Without that flag a fresh
 * event always starts with an empty staff list and admins activate
 * judges/mentors with an explicit click instead of inheriting them
 * from an unrelated past event.
 */
export async function addEventStaff(
  eventId: number | string,
  role: StaffRole,
  input: AddStaffInput
): Promise<AddStaffResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Valid email required");
  }

  let invited = false;
  let assigned = false;
  let inviteErr: string | undefined;
  let assignErr: string | undefined;

  try {
    await apiPost(`/api/events/${eventId}/invites`, { email, role });
    invited = true;
  } catch (e) {
    inviteErr =
      e instanceof ApiError || e instanceof Error ? e.message : "invite failed";
  }

  if (input.assignImmediately) {
    try {
      const body: Record<string, unknown> = { email };
      if (role === "mentor") {
        if (input.expertise !== undefined) body.expertise = input.expertise;
        if (input.availability !== undefined)
          body.availability = input.availability;
      } else if (role === "volunteer") {
        if (input.expertise !== undefined) {
          body.assigned_tasks = input.expertise;
          body.assignedTasks = input.expertise;
        }
      }
      await apiPost(assignmentEndpoint(eventId, role), body);
      assigned = true;
    } catch (e) {
      assignErr =
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "assign failed";
    }
  }

  if (!invited && !assigned) {
    return {
      invited: false,
      assigned: false,
      error: inviteErr || assignErr || "Could not add staff",
    };
  }
  return { invited, assigned };
}

/**
 * Update or replace the task notes for an existing event volunteer. Uses the
 * same POST /volunteers upsert the backend already exposes for direct-assign.
 * Only works once the user account exists and is linked (active row in DB).
 */
export async function updateVolunteerAssignedTasks(
  eventId: number | string,
  email: string,
  assignedTasks: string
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Valid email required");
  }
  await apiPost(assignmentEndpoint(eventId, "volunteer"), {
    email: normalized,
    assigned_tasks: assignedTasks,
    assignedTasks: assignedTasks,
  });
}

/**
 * Result of an activate-pending call. Using a discriminated union so the
 * UI can show a precise message instead of a single generic "Could not
 * activate" — which previously hid two very different states:
 *   - the user genuinely hasn't registered yet (admin must share the invite link)
 *   - the user IS registered, but some other backend condition failed
 *     (permission, duplicate, 500, etc.) — hiding this as "register first"
 *     sent admins down the wrong rabbit hole (see mentor-activation bug).
 */
export type ActivatePendingResult =
  | { ok: true }
  | { ok: false; reason: "user-not-registered"; message: string }
  | { ok: false; reason: "already-active"; message: string }
  | { ok: false; reason: "forbidden"; message: string }
  | { ok: false; reason: "unknown"; message: string; status?: number };

/**
 * Manually flip a pending invite into an Active assignment. Works only
 * for accounts that already exist — backend resolves the user by email.
 * Returns a structured result so the caller can distinguish
 * "user still needs to register" from any other backend error.
 */
export async function activatePendingStaff(
  eventId: number | string,
  role: StaffRole,
  email: string,
  extras?: Pick<AddStaffInput, "expertise" | "availability">,
): Promise<ActivatePendingResult> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return { ok: false, reason: "unknown", message: "Invalid email" };
  }
  const body: Record<string, unknown> = { email: normalized };
  if (role === "mentor" && extras) {
    if (extras.expertise !== undefined) body.expertise = extras.expertise;
    if (extras.availability !== undefined) body.availability = extras.availability;
  } else if (role === "volunteer" && extras?.expertise !== undefined) {
    body.assigned_tasks = extras.expertise;
    body.assignedTasks = extras.expertise;
  }
  try {
    await apiPost(assignmentEndpoint(eventId, role), body);
    return { ok: true };
  } catch (e) {
    const status = e instanceof ApiError ? e.status : undefined;
    const rawMsg =
      e instanceof ApiError || e instanceof Error ? e.message : "";
    const lowered = rawMsg.toLowerCase();
    if (
      status === 404 ||
      lowered.includes("istifadəçi tapılmadı") ||
      lowered.includes("user not found") ||
      lowered.includes("not found")
    ) {
      return {
        ok: false,
        reason: "user-not-registered",
        message: rawMsg || "User has not registered yet",
      };
    }
    if (status === 409 || lowered.includes("already")) {
      return {
        ok: false,
        reason: "already-active",
        message: rawMsg || "Already assigned",
      };
    }
    if (status === 401 || status === 403) {
      return {
        ok: false,
        reason: "forbidden",
        message: rawMsg || "Not allowed",
      };
    }
    return {
      ok: false,
      reason: "unknown",
      message: rawMsg || "Assignment failed",
      status,
    };
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Remove                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Remove a staff member. Handles both cases:
 *   - active assignment → DELETE /mentors/:id or /judging/judges/:id
 *   - pending invite    → DELETE /invites/:id
 */
export async function removeEventStaff(
  eventId: number | string,
  role: StaffRole,
  row: Pick<StaffRow, "assignmentId" | "inviteId">
): Promise<void> {
  if (row.assignmentId != null) {
    await apiDelete(`${assignmentEndpoint(eventId, role)}/${row.assignmentId}`);
  }
  if (row.inviteId != null) {
    await apiDelete(`/api/events/${eventId}/invites/${row.inviteId}`);
  }
}
