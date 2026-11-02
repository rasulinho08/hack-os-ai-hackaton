/**
 * Volunteers and their tasks, as the organiser's page and the volunteer's
 * portal see them.
 */

export type TaskStatus = "todo" | "doing" | "done";
export const TASK_STATUSES: TaskStatus[] = ["todo", "doing", "done"];

export interface VolunteerTask {
  id: number;
  title: string;
  details: string | null;
  location: string | null;
  dueAt: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  status: TaskStatus;
  doneAt: string | null;
  createdAt: string | null;
}

export interface VolunteerRow {
  id: number;
  userId: number;
  name: string;
  email: string;
  note: string | null;
  todo: number;
  doing: number;
  done: number;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function normalizeTask(raw: unknown): VolunteerTask | null {
  const o = obj(raw);
  const id = num(o.id);
  if (!id) return null;
  const st = String(o.status ?? "todo");
  return {
    id,
    title: String(o.title ?? "").trim() || "—",
    details: str(o.details),
    location: str(o.location),
    dueAt: str(o.due_at),
    assigneeId: num(o.assignee_id),
    assigneeName: str(o.assignee_name),
    status: (TASK_STATUSES as string[]).includes(st) ? (st as TaskStatus) : "todo",
    doneAt: str(o.done_at),
    createdAt: str(o.created_at),
  };
}

export const normalizeTasks = (raw: unknown): VolunteerTask[] =>
  (Array.isArray(raw) ? raw : []).map(normalizeTask).filter((t): t is VolunteerTask => t !== null);

export function normalizeVolunteers(raw: unknown): VolunteerRow[] {
  return (Array.isArray(raw) ? raw : []).map((x) => {
    const o = obj(x);
    return {
      id: num(o.id) ?? 0,
      userId: num(o.user_id) ?? 0,
      name: String(o.full_name ?? "").trim() || String(o.email ?? "—"),
      email: String(o.email ?? ""),
      note: str(o.assigned_tasks),
      todo: num(o.tasks_todo) ?? 0,
      doing: num(o.tasks_doing) ?? 0,
      done: num(o.tasks_done) ?? 0,
    };
  }).filter((v) => v.id > 0);
}

/** Not done and past its due time. */
export const isOverdue = (task: VolunteerTask, now = Date.now()) =>
  task.status !== "done" && task.dueAt != null && new Date(task.dueAt).getTime() < now;

/** Share of a volunteer's tasks that are done (0–100), or null with no tasks. */
export function progress(v: { todo: number; doing: number; done: number }): number | null {
  const total = v.todo + v.doing + v.done;
  return total ? Math.round((v.done / total) * 100) : null;
}

/** A local `<input type="datetime-local">` value from an ISO time (and back). */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
