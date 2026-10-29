/**
 * @file teamInvite.controller.js
 * @description HTTP handlers for peer-to-peer team invite flow.
 */

const teamInviteService = require('../services/teamInvite.service');
const { errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const send = async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const toUserIdRaw = body.toUserId ?? body.to_user_id;
    const eventIdRaw = body.eventId ?? body.event_id;
    const fromUserId = req.user.id;

    const toUserId = parseInt(String(toUserIdRaw ?? '').trim(), 10);
    const eventId = parseInt(String(eventIdRaw ?? '').trim(), 10);
    if (!Number.isFinite(toUserId) || toUserId <= 0 || !Number.isFinite(eventId) || eventId <= 0) {
      return errorResponse(
        res,
        HTTP.BAD_REQUEST,
        'Could not send this invite. Refresh the page and try again.',
      );
    }

    const invite = await teamInviteService.sendInvite(fromUserId, toUserId, eventId);
    res.status(201).json({ success: true, data: invite });
  } catch (error) {
    // The code rides along (TEAM_FORMATION_CLOSED, ALREADY_IN_TEAM, …) so the
    // page can say what happened in the reader's language.
    return errorFromException(res, next, error);
  }
};

const incoming = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { eventId } = req.query;
    const data = await teamInviteService.getIncomingInvites(userId, eventId || null);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const outgoing = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { eventId } = req.query;
    const data = await teamInviteService.getOutgoingInvites(userId, eventId || null);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const accept = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const result = await teamInviteService.acceptInvite(id, userId);
    let message = 'Invite accepted, team created!';
    if (result.alreadyAccepted) message = 'Invite was already accepted';
    else if (result.alreadyOnTeam)
      message = 'You are already on a team for this event';
    res.status(200).json({ success: true, data: result, message });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const decline = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    await teamInviteService.declineInvite(id, userId);
    res.status(200).json({ success: true, message: 'Invite declined' });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const cancel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    await teamInviteService.cancelInvite(id, userId);
    res.status(200).json({ success: true, message: 'Invite cancelled' });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

module.exports = { send, incoming, outgoing, accept, decline, cancel };
