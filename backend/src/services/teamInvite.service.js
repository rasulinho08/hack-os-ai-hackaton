/**
 * @file teamInvite.service.js
 * @description Business logic for peer-to-peer team invitations between solo hackers.
 *
 * Flow:
 *   1. Hacker A sends an invite to Hacker B for an event
 *   2. Hacker B accepts → a team is created (or B joins A's existing team)
 *   3. All other pending invites for both users in the event are auto-cancelled
 */

const crypto = require('crypto');
const db     = require('../config/db');
const notifications = require('./notification.service');
const { assertTeamFormationOpen } = require('./event.service');
const {
  assertHackerApprovedForEvent,
  isHackerApprovedForEvent,
} = require('./participant.service');

/**
 * Send a team invite from one solo hacker to another.
 * Validates that the target user is not already on a team.
 *
 * @param {number|string} fromUserId - Sender user ID
 * @param {number|string} toUserId   - Recipient user ID
 * @param {number|string} eventId
 * @returns {Promise<object>} Created/updated team_invites row
 * @throws {Error} 400 if target is already in a team
 * @throws {Error} 409 if invite already pending
 */
const sendInvite = async (fromUserId, toUserId, eventId) => {
  // Problem 24: once the event clock starts, lobby invites should no
  // longer be possible. We block this at the service so neither the
  // sender's UI nor the recipient's inbox can sneak around it.
  await assertTeamFormationOpen(eventId);

  // Problem 13: only admin-approved hackers are allowed to form teams.
  // Both sender AND recipient must be approved — otherwise a rejected
  // hacker could still trigger team creation by tricking an approved
  // hacker into accepting their invite.
  await assertHackerApprovedForEvent(fromUserId, eventId);
  const targetApproved = await isHackerApprovedForEvent(toUserId, eventId);
  if (!targetApproved) {
    throw Object.assign(
      new Error('This user is not approved for the event yet'),
      { statusCode: 400, code: 'TARGET_NOT_APPROVED' }
    );
  }

  // Check: target must not already be in a team for this event
  const targetTeam = await db.query(
    `SELECT tm.team_id FROM team_members tm
     JOIN teams t ON tm.team_id = t.id
     WHERE tm.user_id = $1 AND t.event_id = $2`,
    [toUserId, eventId]
  );
  if (targetTeam.rows.length > 0) {
    throw Object.assign(new Error('This user is already in a team'), { statusCode: 400, code: 'ALREADY_IN_TEAM' });
  }

  // Check: no duplicate pending invite
  const existing = await db.query(
    `SELECT id FROM team_invites
     WHERE from_user_id = $1 AND to_user_id = $2 AND event_id = $3 AND status = 'pending'`,
    [fromUserId, toUserId, eventId]
  );
  if (existing.rows.length > 0) {
    throw Object.assign(new Error('Invite already sent'), { statusCode: 409, code: 'INVITE_EXISTS' });
  }

  const result = await db.query(
    `INSERT INTO team_invites (from_user_id, to_user_id, event_id, status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (from_user_id, to_user_id, event_id)
     DO UPDATE SET status = 'pending', updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [fromUserId, toUserId, eventId]
  );
  const invite = result.rows[0];
  const from = (await db.query(
    `SELECT u.full_name, t.name AS team_name FROM users u
       LEFT JOIN team_members tm ON tm.user_id = u.id
       LEFT JOIN teams t ON t.id = tm.team_id AND t.event_id = $2
      WHERE u.id = $1 ORDER BY t.id NULLS LAST LIMIT 1`,
    [fromUserId, eventId]
  )).rows[0];
  await notifications.notify([toUserId], {
    eventId: Number(eventId),
    kind: 'team.invite',
    target: 'team',
    data: { inviteId: invite.id, name: from?.full_name || null, team: from?.team_name || null },
    dedupeKey: `tinv:${invite.id}:${new Date(invite.updated_at || invite.created_at || Date.now()).getTime()}`,
  });
  return invite;
};

/**
 * Get pending invites sent TO this user (inbox).
 *
 * @param {number|string} userId
 * @param {number|string} [eventId]
 * @returns {Promise<object[]>}
 */
const getIncomingInvites = async (userId, eventId) => {
  const result = await db.query(
    `SELECT ti.*, u.full_name AS from_name, u.email AS from_email
     FROM team_invites ti
     JOIN users u ON ti.from_user_id = u.id
     WHERE ti.to_user_id = $1 AND ti.status = 'pending'
     ${eventId ? 'AND ti.event_id = $2' : ''}
     ORDER BY ti.created_at DESC`,
    eventId ? [userId, eventId] : [userId]
  );
  return result.rows;
};

/**
 * Get invites sent BY this user (outbox).
 *
 * @param {number|string} userId
 * @param {number|string} [eventId]
 * @returns {Promise<object[]>}
 */
const getOutgoingInvites = async (userId, eventId) => {
  const result = await db.query(
    `SELECT ti.*, u.full_name AS to_name, u.email AS to_email
     FROM team_invites ti
     JOIN users u ON ti.to_user_id = u.id
     WHERE ti.from_user_id = $1 AND ti.status = 'pending'
     ${eventId ? 'AND ti.event_id = $2' : ''}
     ORDER BY ti.created_at DESC`,
    eventId ? [userId, eventId] : [userId]
  );
  return result.rows;
};

/**
 * Accept an incoming team invite.
 *
 * If the sender already has a team → add accepter to that team (capacity checked).
 * If neither has a team → create a new team with both.
 * Marks the invite as 'accepted' and cancels all other pending invites for both users.
 *
 * @param {number|string} inviteId - team_invites.id
 * @param {number|string} userId   - Accepting user ID (must match to_user_id)
 * @returns {Promise<{ teamId: number, eventId: number }>}
 * @throws {Error} 404 if invite not found or already processed
 * @throws {Error} 400 if sender's team is full
 */
const acceptInvite = async (inviteId, userId) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch + lock the invite row so concurrent accepts of the same invite
    // (the "double-tap → failed" case in the screenshot) serialise instead
    // of racing each other.
    const inviteResult = await client.query(
      `SELECT * FROM team_invites
       WHERE id = $1 AND to_user_id = $2
       FOR UPDATE`,
      [inviteId, userId]
    );
    const invite = inviteResult.rows[0];
    if (!invite) {
      throw Object.assign(
        new Error('Invite not found'),
        { statusCode: 404, code: 'INVITE_NOT_FOUND' }
      );
    }

    // Problem 24: even if the invite was sent before the event started,
    // accepting it after start_date would still cause team membership
    // to change mid-event. Block here too. We allow already-accepted
    // invites to short-circuit below (no membership mutation), so this
    // guard runs only for invites that would actually change rosters.
    if (invite.status === 'pending') {
      await assertTeamFormationOpen(invite.event_id);
      // Problem 13: both the accepter AND the sender must be admin-
      // approved participants. Without this an unapproved hacker could
      // still climb onto a team by either inviting someone or accepting
      // an invite, because the old code below was silently upserting
      // `status = 'approved'` for both users.
      await assertHackerApprovedForEvent(userId, invite.event_id, client);
      const senderApproved = await isHackerApprovedForEvent(
        invite.from_user_id,
        invite.event_id,
        client
      );
      if (!senderApproved) {
        throw Object.assign(
          new Error('The user who invited you is not approved for this event'),
          { statusCode: 400, code: 'SENDER_NOT_APPROVED' }
        );
      }
    }

    // Idempotency: if the invite was already accepted, just return the
    // existing team instead of throwing — this is what makes a refresh /
    // double-click feel like a no-op rather than a "failed" toast.
    if (invite.status === 'accepted') {
      const existing = await client.query(
        `SELECT tm.team_id FROM team_members tm
         JOIN teams t ON tm.team_id = t.id
         WHERE tm.user_id = $1 AND t.event_id = $2
         LIMIT 1`,
        [userId, invite.event_id]
      );
      const existingTeamId = existing.rows[0]?.team_id;
      if (existingTeamId) {
        await client.query('COMMIT');
        return { teamId: existingTeamId, eventId: invite.event_id, alreadyAccepted: true };
      }
      // accepted in DB but no membership? fall through and treat like fresh
    } else if (invite.status !== 'pending') {
      throw Object.assign(
        new Error('Invite is no longer pending'),
        { statusCode: 400, code: 'INVITE_CLOSED' }
      );
    }

    // ⚑ Hard guard: if the accepter is ALREADY in a team for this event we
    // must not create a second membership row — that's exactly the bug
    // shown in the screenshot (Yussef in two teams). Either treat the
    // accept as a no-op, or reject with a clear 409.
    const accepterTeamResult = await client.query(
      `SELECT tm.team_id FROM team_members tm
       JOIN teams t ON tm.team_id = t.id
       WHERE tm.user_id = $1 AND t.event_id = $2
       LIMIT 1`,
      [userId, invite.event_id]
    );
    if (accepterTeamResult.rows.length > 0) {
      const existingTeamId = accepterTeamResult.rows[0].team_id;
      // Mark this invite as accepted and cancel the rest so the user's
      // inbox clears up, but DO NOT add a second membership row.
      await client.query(
        `UPDATE team_invites
         SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [inviteId]
      );
      await client.query(
        `UPDATE team_invites
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE event_id = $1 AND status = 'pending'
           AND (to_user_id = $2 OR from_user_id = $2)
           AND id != $3`,
        [invite.event_id, userId, inviteId]
      );
      await client.query('COMMIT');
      return {
        teamId: existingTeamId,
        eventId: invite.event_id,
        alreadyOnTeam: true,
      };
    }

    // Check if sender already has a team
    const senderTeamResult = await client.query(
      `SELECT tm.team_id FROM team_members tm
       JOIN teams t ON tm.team_id = t.id
       WHERE tm.user_id = $1 AND t.event_id = $2
       LIMIT 1`,
      [invite.from_user_id, invite.event_id]
    );

    let teamId;

    if (senderTeamResult.rows.length > 0) {
      // ── Case A: Sender has a team — join it ────────────────────────────
      teamId = senderTeamResult.rows[0].team_id;

      const [countRes, sizeRes] = await Promise.all([
        client.query('SELECT COUNT(*) AS cnt FROM team_members WHERE team_id = $1', [teamId]),
        client.query(
          `SELECT e.team_size_limit FROM teams t JOIN events e ON t.event_id = e.id WHERE t.id = $1`,
          [teamId]
        ),
      ]);
      const limit = sizeRes.rows[0]?.team_size_limit || 4;
      if (parseInt(countRes.rows[0].cnt, 10) >= limit) {
        throw Object.assign(new Error('Team is full'), { statusCode: 400, code: 'TEAM_FULL' });
      }

      // Defensive: ON CONFLICT DO NOTHING so a duplicate request from a
      // double-tap can never produce a primary-key violation.
      await client.query(
        `INSERT INTO team_members (team_id, user_id, is_leader)
         VALUES ($1, $2, false)
         ON CONFLICT (team_id, user_id) DO NOTHING`,
        [teamId, userId]
      );
    } else {
      // ── Case B: Neither has a team — create one ─────────────────────────
      const joinCode = crypto.randomBytes(4).toString('hex');

      const [senderInfo, accepterInfo] = await Promise.all([
        client.query('SELECT full_name FROM users WHERE id = $1', [invite.from_user_id]),
        client.query('SELECT full_name FROM users WHERE id = $1', [userId]),
      ]);
      const senderName   = (senderInfo.rows[0]?.full_name   || 'Hacker').split(' ')[0];
      const accepterName = (accepterInfo.rows[0]?.full_name || 'Hacker').split(' ')[0];
      const teamName     = `${senderName} & ${accepterName}`;

      const teamResult = await client.query(
        `INSERT INTO teams (name, event_id, leader_id, join_code)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [teamName, invite.event_id, invite.from_user_id, joinCode]
      );
      teamId = teamResult.rows[0].id;

      await client.query(
        `INSERT INTO team_members (team_id, user_id, is_leader)
         VALUES ($1, $2, true), ($1, $3, false)
         ON CONFLICT (team_id, user_id) DO NOTHING`,
        [teamId, invite.from_user_id, userId]
      );
    }

    // Both users were already verified as `approved` above. We keep the
    // idempotent INSERT so a missing participants row (historical data
    // quirks) doesn't break accept, but we must NOT overwrite an existing
    // row's status — doing so would silently promote a rejected/pending
    // hacker to approved (problem 13).
    await Promise.all([
      client.query(
        `INSERT INTO participants (user_id, event_id, status)
         VALUES ($1, $2, 'approved')
         ON CONFLICT (user_id, event_id) DO NOTHING`,
        [invite.from_user_id, invite.event_id]
      ),
      client.query(
        `INSERT INTO participants (user_id, event_id, status)
         VALUES ($1, $2, 'approved')
         ON CONFLICT (user_id, event_id) DO NOTHING`,
        [userId, invite.event_id]
      ),
    ]);

    // Mark this invite as accepted
    await client.query(
      `UPDATE team_invites
       SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [inviteId]
    );

    // Cancel all OTHER pending invites for both users in this event so
    // the inbox stops offering already-resolved actions.
    await client.query(
      `UPDATE team_invites
       SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
       WHERE event_id = $1 AND status = 'pending'
         AND (to_user_id = $2 OR to_user_id = $3 OR from_user_id = $2 OR from_user_id = $3)
         AND id != $4`,
      [invite.event_id, invite.from_user_id, userId, inviteId]
    );

    await client.query('COMMIT');
    return { teamId, eventId: invite.event_id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Decline an incoming invite (recipient action).
 *
 * @param {number|string} inviteId
 * @param {number|string} userId - Must be the to_user_id
 * @returns {Promise<object>} Updated invite row
 * @throws {Error} 404 if invite not found
 */
const declineInvite = async (inviteId, userId) => {
  const result = await db.query(
    `UPDATE team_invites
     SET status = 'declined', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND to_user_id = $2 AND status = 'pending'
     RETURNING *`,
    [inviteId, userId]
  );
  if (!result.rows[0]) {
    throw Object.assign(new Error('Invite not found'), { statusCode: 404, code: 'INVITE_NOT_FOUND' });
  }
  return result.rows[0];
};

/**
 * Cancel a sent invite (sender action).
 *
 * @param {number|string} inviteId
 * @param {number|string} userId - Must be the from_user_id
 * @returns {Promise<object>} Updated invite row
 * @throws {Error} 404 if invite not found
 */
const cancelInvite = async (inviteId, userId) => {
  const result = await db.query(
    `UPDATE team_invites
     SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND from_user_id = $2 AND status = 'pending'
     RETURNING *`,
    [inviteId, userId]
  );
  if (!result.rows[0]) {
    throw Object.assign(new Error('Invite not found'), { statusCode: 404, code: 'INVITE_NOT_FOUND' });
  }
  return result.rows[0];
};

module.exports = {
  sendInvite,
  getIncomingInvites,
  getOutgoingInvites,
  acceptInvite,
  declineInvite,
  cancelInvite,
};
