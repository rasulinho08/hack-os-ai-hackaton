/**
 * "My workspaces": every organisation a person manages and every event they
 * have a role in, from GET /api/me/workspaces.
 *
 * One account can be a participant in one hackathon and a judge in another.
 * The API works out the role per request from the event the request is about;
 * when nothing names an event it reads the `hh_event` cookie, which entering a
 * workspace sets. Entering a workspace therefore means: set (or clear) that
 * cookie, ask /api/auth/me which role now applies, store it in `hh_role` for
 * the middleware, and go to that role's home.
 */

import { apiGet, apiPost } from "@/lib/api";
import { ROLE_REDIRECT } from "@/lib/roleRedirect";
import { adminHost } from "@/lib/hosts";

export type EventRole = "organizer" | "judge" | "mentor" | "volunteer" | "participant";
export type OrgRole = "owner" | "admin" | "organizer" | "viewer";

export interface WorkspaceOrg {
  id: number;
  name: string;
  slug: string | null;
  status: string;
  logo_url: string | null;
  role: OrgRole;
}

export interface WorkspaceEvent {
  id: number;
  name: string;
  event_code: string | null;
  customer_id: number | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  role: EventRole;
  participant_status: string | null;
}

export interface Workspaces {
  organizations: WorkspaceOrg[];
  events: WorkspaceEvent[];
  platformRole: "superadmin" | null;
  elevationRequired: boolean;
  activeEventId: number | null;
}

export type WorkspaceEntry =
  | { kind: "org"; org: WorkspaceOrg }
  | { kind: "event"; event: WorkspaceEvent }
  | { kind: "console" };

export interface SessionView {
  role?: string;
  email?: string;
  status?: string;
  platformRole?: string | null;
  elevationRequired?: boolean;
}

const EVENT_COOKIE = "hh_event";

function cookie(name: string, value: string | null, days = 30) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  if (value === null) {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    return;
  }
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${days * 86400}; SameSite=Lax${secure}`;
}

export function fetchWorkspaces(): Promise<Workspaces> {
  return apiGet<Workspaces>("/api/me/workspaces");
}

/** The value of the hh_event cookie: the event the person entered, if any. */
export function enteredEventId(): number | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)hh_event=([^;]+)/);
  const n = m ? Number(decodeURIComponent(m[1])) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The events a person has `role` in, the one they work in first: the event
 * they entered, else one running now, else the next to start, else the
 * latest. Never another organisation's event: the list is the person's own.
 */
export async function myEventsAs(role: EventRole): Promise<WorkspaceEvent[]> {
  const ws = await fetchWorkspaces();
  const mine = ws.events.filter((e) => e.role === role);
  const now = Date.now();
  const ms = (v: string | null) => (v ? new Date(v).getTime() : NaN);
  const rank = (e: WorkspaceEvent) => {
    if (e.id === enteredEventId()) return 0;
    const start = ms(e.start_date);
    const end = ms(e.end_date);
    if (start <= now && (Number.isNaN(end) || now <= end)) return 1;
    if (start > now) return 2;
    return 3;
  };
  return [...mine].sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? ms(a.start_date) - ms(b.start_date) : ms(b.start_date) - ms(a.start_date)));
}

/**
 * The workspaces a person can enter, in the order the picker shows them.
 * Events a participant is not admitted to yet are still listed (with their
 * status) so the person can see where they stand.
 */
export function entriesFrom(ws: Workspaces): WorkspaceEntry[] {
  const out: WorkspaceEntry[] = [];
  if (ws.platformRole === "superadmin") out.push({ kind: "console" });
  for (const org of ws.organizations) {
    if (org.role !== "viewer" && org.status !== "cancelled") out.push({ kind: "org", org });
  }
  for (const event of ws.events) {
    // Organisers reach their events from the organisation's dashboard.
    if (event.role === "organizer" && ws.organizations.some((o) => o.id === event.customer_id)) continue;
    out.push({ kind: "event", event });
  }
  return out;
}

/**
 * A participant may enter only once the organiser has admitted them; an
 * organisation only once its order has been approved.
 */
export function isEnterable(entry: WorkspaceEntry): boolean {
  if (entry.kind === "org") return entry.org.status === "active" || entry.org.status === "pending_setup";
  if (entry.kind !== "event") return true;
  if (entry.event.role !== "participant") return true;
  return entry.event.participant_status === "approved" || entry.event.participant_status === "eliminated";
}

/**
 * Where the owner console lives: its own host when NEXT_PUBLIC_ADMIN_HOST is
 * set (every other host answers 404 for /workspace), else /workspace.
 */
export function consoleHref(): string {
  const host = adminHost();
  if (!host) return "/workspace";
  const protocol = typeof window !== "undefined" ? window.location.protocol : "https:";
  return `${protocol}//${host}/`;
}

/**
 * Copy the API's view of this session into the cookies the middleware reads
 * (`hh_role` must match the role /api/auth/me reports, or API calls are
 * refused). Call it after signing in and after choosing a workspace.
 */
export async function syncSession(): Promise<SessionView> {
  const me = await apiGet<SessionView>("/api/auth/me");
  cookie("hh_role", String(me?.role || "").trim().toLowerCase(), 14);
  if (me?.email) cookie("hh_email", me.email, 14);
  if (me?.status) cookie("hh_status", me.status, 14);
  else cookie("hh_status", null);
  return me;
}

/**
 * Enter a workspace and return where to go. The caller navigates (router or
 * window.location) so this stays usable from any component.
 */
export async function enterWorkspace(entry: WorkspaceEntry): Promise<string> {
  if (entry.kind === "console") return consoleHref();
  cookie(EVENT_COOKIE, entry.kind === "event" ? String(entry.event.id) : null);
  const me = await syncSession();
  return ROLE_REDIRECT[String(me?.role || "").trim().toLowerCase()] || "/";
}

/**
 * Work in one event: the builder and the dashboard after it act on this
 * event, and the role cookie follows what the API reports for it.
 */
export async function enterEventWorkspace(eventId: number): Promise<SessionView | null> {
  cookie(EVENT_COOKIE, String(eventId));
  try {
    window.localStorage.setItem("hh_active_event_id", String(eventId));
  } catch {
    /* storage can be unavailable (private mode); the cookie is enough */
  }
  try {
    return await syncSession();
  } catch {
    return null;
  }
}

/** Forget the chosen workspace (sign-out, or "switch workspace"). */
export function clearWorkspace() {
  cookie(EVENT_COOKIE, null);
}

/** Sign out of the API and drop every client-side cookie we set. */
export async function signOut() {
  try {
    await apiPost("/api/auth/logout", {});
  } catch {
    /* cookies below are cleared either way */
  }
  for (const c of ["hh_role", "hh_email", "hh_status", EVENT_COOKIE]) cookie(c, null);
}
