/**
 * @file volunteer.controller.js
 * @description HTTP handlers for an event's volunteers and their tasks.
 *
 *   GET    /api/events/:eventId/volunteers            volunteers with task progress (organisers, volunteers)
 *   POST   /api/events/:eventId/volunteers            add by e-mail (organiser)
 *   GET    /api/events/:eventId/volunteers/me         the calling volunteer and their tasks
 *   PUT    /api/events/:eventId/volunteers/:id        change the note (organiser)
 *   DELETE /api/events/:eventId/volunteers/:id        remove (organiser)
 *   GET    /api/events/:eventId/volunteer-tasks       tasks (organiser: all; volunteer: own + free)
 *   POST   /api/events/:eventId/volunteer-tasks       create (organiser)
 *   PATCH  /api/events/:eventId/volunteer-tasks/:id   change (organiser: anything; volunteer: take / hand back / status)
 *   DELETE /api/events/:eventId/volunteer-tasks/:id   delete (organiser)
 */

const volunteerService = require('../services/volunteer.service');
const jobs = require('../services/jobs.service');
const audit = require('../services/audit.service');
const { isAdminUser } = require('../utils/authz');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const actorOf = (req) => ({ id: req.user.id, isAdmin: isAdminUser(req.user) });

/** Tell a volunteer they have a new task (Telegram, best effort). */
function tellAssignee(eventId, task, actorId) {
  if (!task || !task.assignee_id || Number(task.assignee_id) === Number(actorId)) return null;
  return jobs.enqueue('volunteer.task_assigned', { eventId: Number(eventId), taskId: task.id })
    .catch((err) => console.error('[volunteer] notify failed:', err.message));
}

const getVolunteers = async (req, res, next) => {
  try {
    const rows = await volunteerService.getVolunteers(req.params.eventId);
    return successResponse(res, HTTP.OK, 'Volunteers retrieved successfully', rows);
  } catch (error) {
    return next(error);
  }
};

const addVolunteer = async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const assignedTasks = body.assigned_tasks !== undefined ? body.assigned_tasks : body.assignedTasks;
    if (!body.email) return errorResponse(res, HTTP.BAD_REQUEST, 'Email is required', null, 'VALIDATION_ERROR');
    const volunteer = await volunteerService.addVolunteer(req.params.eventId, body.email, assignedTasks);
    await audit.record(req, 'volunteer.added', { eventId: Number(req.params.eventId), targetType: 'user', targetId: volunteer.user_id });
    return successResponse(res, HTTP.CREATED, 'Volunteer added successfully', volunteer);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const updateVolunteer = async (req, res, next) => {
  try {
    const body = req.body || {};
    const note = body.assigned_tasks !== undefined ? body.assigned_tasks : body.assignedTasks;
    const row = await volunteerService.updateVolunteer(req.params.eventId, req.params.id, { assignedTasks: note });
    if (!row) return errorResponse(res, HTTP.NOT_FOUND, 'Volunteer not found', null, 'NOT_FOUND');
    return successResponse(res, HTTP.OK, 'Saved', row);
  } catch (error) {
    return next(error);
  }
};

const removeVolunteer = async (req, res, next) => {
  try {
    await volunteerService.removeVolunteer(req.params.eventId, req.params.id);
    await audit.record(req, 'volunteer.removed', { eventId: Number(req.params.eventId), targetType: 'volunteer', targetId: Number(req.params.id) });
    return successResponse(res, HTTP.OK, 'Volunteer removed successfully');
  } catch (error) {
    return next(error);
  }
};

const getMine = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.OK, 'OK', await volunteerService.getMine(req.params.eventId, req.user.id));
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const listTasks = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    if (isAdminUser(req.user)) return successResponse(res, HTTP.OK, 'OK', await volunteerService.listTasks(eventId));
    if (!(await volunteerService.isVolunteer(eventId, req.user.id))) {
      return errorResponse(res, HTTP.FORBIDDEN, 'You are not a volunteer for this event', null, 'NOT_EVENT_VOLUNTEER');
    }
    return successResponse(res, HTTP.OK, 'OK', await volunteerService.listTasks(eventId, { forUser: req.user.id }));
  } catch (error) {
    return next(error);
  }
};

const createTask = async (req, res, next) => {
  try {
    const task = await volunteerService.createTask(req.params.eventId, req.body, req.user.id);
    await tellAssignee(req.params.eventId, task, req.user.id);
    return successResponse(res, HTTP.CREATED, 'Task created', task);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const updateTask = async (req, res, next) => {
  try {
    const { eventId, taskId } = req.params;
    const actor = actorOf(req);
    if (!actor.isAdmin && !(await volunteerService.isVolunteer(eventId, actor.id))) {
      return errorResponse(res, HTTP.FORBIDDEN, 'You are not a volunteer for this event', null, 'NOT_EVENT_VOLUNTEER');
    }
    const before = (req.body && ('assigneeId' in req.body || 'assignee_id' in req.body));
    const task = await volunteerService.updateTask(eventId, taskId, req.body, actor);
    if (before && actor.isAdmin) await tellAssignee(eventId, task, actor.id);
    return successResponse(res, HTTP.OK, 'Saved', task);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const deleteTask = async (req, res, next) => {
  try {
    await volunteerService.deleteTask(req.params.eventId, req.params.taskId);
    return successResponse(res, HTTP.OK, 'Task deleted');
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

module.exports = {
  getVolunteers,
  addVolunteer,
  updateVolunteer,
  removeVolunteer,
  getMine,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
};
