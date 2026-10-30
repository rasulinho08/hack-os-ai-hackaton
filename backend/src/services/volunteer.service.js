/**
 * @file volunteer.service.js
 * @description Volunteers of an event and their tasks.
 *
 * A volunteer is assigned per event (`volunteers`, with an organiser's note
 * in `assigned_tasks`). Tasks (`volunteer_tasks`) are the actual work: a
 * title, details, a place, a due time, who does it, and todo / doing / done.
 *
 *   organisers   create, edit, assign, delete any task of their event
 *   volunteers   see their own tasks and the unassigned ones; take an
 *                unassigned task, hand it back, move their own between
 *                todo, doing and done
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { notVerifiedError } = require('../utils/resolveUserId');

const TASK_STATUSES = ['todo', 'doing', 'done'];

// ─────────────────────────────────────────────────────────────────────────────
// Volunteers
// ─────────────────────────────────────────────────────────────────────────────

/** The event's volunteers with how far along their tasks are. */
const getVolunteers = async (eventId) => {
  const result = await db.query(
    `SELECT v.id, v.event_id, v.user_id, v.assigned_tasks, v.created_at,
            u.full_name, u.email,
            COUNT(t.id) FILTER (WHERE t.status = 'todo')::int  AS tasks_todo,
            COUNT(t.id) FILTER (WHERE t.status = 'doing')::int AS tasks_doing,
            COUNT(t.id) FILTER (WHERE t.status = 'done')::int  AS tasks_done
       FROM volunteers v
       JOIN users u ON v.user_id = u.id
       LEFT JOIN volunteer_tasks t ON t.event_id = v.event_id AND t.assignee_id = v.user_id
      WHERE v.event_id = $1
      GROUP BY v.id, u.id
      ORDER BY u.full_name ASC`,
    [eventId],
  );
  return result.rows;
};

/** Add a volunteer by e-mail (the person needs an account; else 404 → invite flow). */
const addVolunteer = async (eventId, email, assignedTasks) => {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const userResult = await db.query('SELECT id, email_verified_at FROM users WHERE LOWER(email) = $1', [normalizedEmail]);
  if (userResult.rows.length === 0) {
    throw Object.assign(new Error('User not found with this email'), { statusCode: 404, code: 'USER_NOT_FOUND' });
  }
  if (!userResult.rows[0].email_verified_at) throw notVerifiedError();
  const userId = userResult.rows[0].id;
  // Idempotent: adding the same person again refreshes the note.
  const result = await db.query(
    `INSERT INTO volunteers (event_id, user_id, assigned_tasks)
     VALUES ($1, $2, $3)
     ON CONFLICT (event_id, user_id) DO UPDATE
       SET assigned_tasks = COALESCE(EXCLUDED.assigned_tasks, volunteers.assigned_tasks)
     RETURNING *`,
    [eventId, userId, assignedTasks || null],
  );
  // No global role change: the volunteer role applies in this event only.
  return result.rows[0];
};

/** An organiser changes the note for a volunteer (an empty note clears it). */
const updateVolunteer = async (eventId, id, { assignedTasks }) => {
  const note = assignedTasks == null ? null : String(assignedTasks).trim().slice(0, 2000) || null;
  const r = await db.query(
    'UPDATE volunteers SET assigned_tasks = $3 WHERE id = $1 AND event_id = $2 RETURNING *',
    [id, eventId, note],
  );
  return r.rows[0] || null;
};

/** Remove a volunteer; their open tasks go back to the unassigned pile. */
const removeVolunteer = async (eventId, volunteerId) => {
  const r = await db.query('DELETE FROM volunteers WHERE id = $1 AND event_id = $2 RETURNING user_id', [volunteerId, eventId]);
  if (r.rows[0]) {
    await db.query(
      `UPDATE volunteer_tasks SET assignee_id = NULL, status = 'todo', updated_at = now()
        WHERE event_id = $1 AND assignee_id = $2 AND status <> 'done'`,
      [eventId, r.rows[0].user_id],
    );
  }
};

async function isVolunteer(eventId, userId) {
  const r = await db.query('SELECT 1 FROM volunteers WHERE event_id = $1 AND user_id = $2', [eventId, userId]);
  return Boolean(r.rows[0]);
}

/** The calling volunteer: their row (with the organiser's note) and their tasks. */
const getMine = async (eventId, userId) => {
  const r = await db.query(
    `SELECT v.id, v.event_id, v.user_id, v.assigned_tasks, v.created_at, u.full_name, u.email
       FROM volunteers v JOIN users u ON u.id = v.user_id
      WHERE v.event_id = $1 AND v.user_id = $2`,
    [eventId, userId],
  );
  if (!r.rows[0]) throw httpError(403, 'You are not a volunteer for this event', 'NOT_EVENT_VOLUNTEER');
  return { ...r.rows[0], tasks: await listTasks(eventId, { forUser: userId }) };
};

// ─────────────────────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tasks of an event, the most pressing first (not done, then by due time).
 * `forUser`: only that volunteer's tasks and the unassigned ones.
 */
async function listTasks(eventId, { forUser = null } = {}) {
  const r = await db.query(
    `SELECT t.*, a.full_name AS assignee_name
       FROM volunteer_tasks t LEFT JOIN users a ON a.id = t.assignee_id
      WHERE t.event_id = $1
        AND ($2::int IS NULL OR t.assignee_id = $2 OR (t.assignee_id IS NULL AND t.status <> 'done'))
      ORDER BY (t.status = 'done') ASC, t.due_at ASC NULLS LAST, t.created_at ASC
      LIMIT 1000`,
    [eventId, forUser],
  );
  return r.rows;
}

const parseDue = (v) => {
  if (v === null || v === '' || v === undefined) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : undefined;
};

/** Validated task fields from a request body (only those present). */
function readTask(body, { creating }) {
  const out = {};
  const errors = [];
  if ('title' in body || creating) {
    const title = String(body.title ?? '').trim();
    if (!title) errors.push({ field: 'title', code: 'REQUIRED', message: 'Give the task a title.' });
    else if (title.length > 160) errors.push({ field: 'title', code: 'TOO_LONG', message: 'At most 160 characters.' });
    else out.title = title;
  }
  if ('details' in body) out.details = String(body.details ?? '').trim().slice(0, 2000) || null;
  if ('location' in body) out.location = String(body.location ?? '').trim().slice(0, 120) || null;
  if ('dueAt' in body || 'due_at' in body) {
    const due = parseDue(body.dueAt ?? body.due_at);
    if (due === undefined) errors.push({ field: 'dueAt', code: 'INVALID', message: 'Not a valid time.' });
    else out.due_at = due;
  }
  if ('assigneeId' in body || 'assignee_id' in body) {
    // `null` means "nobody" (not "absent"), so no ?? here.
    const raw = 'assigneeId' in body ? body.assigneeId : body.assignee_id;
    out.assignee_id = raw === null || raw === '' ? null : Number(raw);
    if (out.assignee_id !== null && !(Number.isInteger(out.assignee_id) && out.assignee_id > 0)) {
      errors.push({ field: 'assigneeId', code: 'INVALID', message: 'Choose a volunteer.' });
    }
  }
  if ('status' in body) {
    const st = String(body.status ?? '').trim().toLowerCase();
    if (!TASK_STATUSES.includes(st)) errors.push({ field: 'status', code: 'INVALID', message: 'todo, doing or done.' });
    else out.status = st;
  }
  if (errors.length) throw httpError(400, errors[0].message, 'TASK_INVALID', { errors });
  return out;
}

async function assertAssignable(eventId, userId) {
  if (userId == null) return;
  if (!(await isVolunteer(eventId, userId))) {
    throw httpError(400, 'Tasks go to volunteers of this event.', 'NOT_EVENT_VOLUNTEER');
  }
}

async function taskRow(eventId, taskId) {
  const r = await db.query('SELECT * FROM volunteer_tasks WHERE id = $1 AND event_id = $2', [taskId, eventId]);
  if (!r.rows[0]) throw httpError(404, 'Task not found', 'NOT_FOUND');
  return r.rows[0];
}

/** An organiser creates a task (optionally for a volunteer). */
async function createTask(eventId, body, actorId) {
  const t = readTask(body || {}, { creating: true });
  await assertAssignable(eventId, t.assignee_id ?? null);
  const status = t.status || 'todo';
  const r = await db.query(
    `INSERT INTO volunteer_tasks (event_id, title, details, location, due_at, assignee_id, status, created_by, done_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [eventId, t.title, t.details ?? null, t.location ?? null, t.due_at ?? null, t.assignee_id ?? null, status, actorId,
      status === 'done' ? new Date() : null],
  );
  return r.rows[0];
}

/**
 * Change a task. Organisers may change anything; a volunteer may take an
 * unassigned task (assigneeId = themselves), hand their own back
 * (assigneeId = null) and change the status of their own.
 */
async function updateTask(eventId, taskId, body, actor) {
  const task = await taskRow(eventId, taskId);
  const changes = readTask(body || {}, { creating: false });
  if (!actor.isAdmin) {
    const mine = Number(task.assignee_id) === Number(actor.id);
    const allowed = new Set(['status', 'assignee_id']);
    if (Object.keys(changes).some((k) => !allowed.has(k))) {
      throw httpError(403, 'Only organisers can edit a task.', 'NOT_ALLOWED');
    }
    if ('assignee_id' in changes) {
      const taking = changes.assignee_id === Number(actor.id) && task.assignee_id == null;
      const handingBack = changes.assignee_id === null && mine;
      if (!taking && !handingBack) throw httpError(403, 'You can take a free task or hand back your own.', 'NOT_ALLOWED');
    } else if (!mine) {
      throw httpError(403, 'This task is not yours.', 'NOT_ALLOWED');
    }
  } else if ('assignee_id' in changes) {
    await assertAssignable(eventId, changes.assignee_id);
  }
  // Handing a task back puts it back to do.
  if ('assignee_id' in changes && changes.assignee_id === null && !('status' in changes)) changes.status = 'todo';

  const cols = Object.keys(changes);
  if (!cols.length) return task;
  const params = [taskId, eventId];
  const sets = cols.map((c) => {
    params.push(changes[c]);
    return `${c} = $${params.length}`;
  });
  // Done gets a time (kept if it was already done); leaving done clears it.
  // (A parameter of its own: reusing the status one gives it two types.)
  if ('status' in changes) {
    params.push(changes.status === 'done');
    sets.push(`done_at = CASE WHEN $${params.length}::boolean THEN COALESCE(done_at, now()) ELSE NULL END`);
  }
  const r = await db.query(
    `UPDATE volunteer_tasks SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1 AND event_id = $2 RETURNING *`,
    params,
  );
  return r.rows[0];
}

async function deleteTask(eventId, taskId) {
  const r = await db.query('DELETE FROM volunteer_tasks WHERE id = $1 AND event_id = $2 RETURNING id', [taskId, eventId]);
  if (!r.rows[0]) throw httpError(404, 'Task not found', 'NOT_FOUND');
}

module.exports = {
  TASK_STATUSES,
  getVolunteers,
  addVolunteer,
  updateVolunteer,
  removeVolunteer,
  isVolunteer,
  getMine,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
};
