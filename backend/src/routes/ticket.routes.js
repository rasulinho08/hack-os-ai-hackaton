const express = require('express');
const ticketController = require('../controllers/ticket.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const { byIdEventAccess } = require('../middlewares/eventAccess');

const router = express.Router();

router.post('/', authMw, roleMw('hacker'), ticketController.createTicket);
// The participant who asked closes their own request (the service checks it is theirs).
router.post('/:id/withdraw', authMw, roleMw('hacker'), byIdEventAccess('help_tickets', { label: 'Ticket' }), ticketController.withdrawTicket);
router.get('/', authMw, roleMw('hacker', 'mentor', 'admin'), ticketController.getTickets);
/** Next.js BFF overlay when API is hit directly — in-memory overlay lives on Next; empty here avoids 404. */
router.get(
  '/escalations-overlay',
  authMw,
  roleMw('mentor', 'admin'),
  (req, res) => {
    res.status(200).json({ success: true, items: [] });
  },
);
router.patch('/:id/claim', authMw, roleMw('mentor', 'admin'), byIdEventAccess('help_tickets', { label: 'Ticket' }), ticketController.claimTicket);
router.patch('/:id/assign', authMw, roleMw('admin'), byIdEventAccess('help_tickets', { label: 'Ticket' }), ticketController.assignTicket);
router.patch('/:id/resolve', authMw, roleMw('mentor', 'admin'), byIdEventAccess('help_tickets', { label: 'Ticket' }), ticketController.resolveTicket);
// Mentor (or admin) un-resolves a ticket they hit "Mark Resolved" on by
// mistake. Goes back to in-progress, mentor stays assigned (problem 23).
router.patch('/:id/unresolve', authMw, roleMw('mentor', 'admin'), byIdEventAccess('help_tickets', { label: 'Ticket' }), ticketController.unresolveTicket);
// Mentor flags a ticket as needing organizer attention; admin can later
// clear the flag once they've reviewed it (problem 22).
// Accept both PATCH and POST: the Next.js app calls POST from the browser;
// when that route is missing or the request is proxied straight to Express,
// PATCH-only used to yield "Cannot POST /api/tickets/:id/escalate".
router.patch('/:id/escalate', authMw, roleMw('mentor', 'admin'), byIdEventAccess('help_tickets', { label: 'Ticket' }), ticketController.escalateTicket);
router.post('/:id/escalate', authMw, roleMw('mentor', 'admin'), byIdEventAccess('help_tickets', { label: 'Ticket' }), ticketController.escalateTicket);
router.patch('/:id/acknowledge-escalation', authMw, roleMw('admin'), byIdEventAccess('help_tickets', { label: 'Ticket' }), ticketController.acknowledgeEscalation);
router.patch('/:id', authMw, roleMw('admin'), byIdEventAccess('help_tickets', { label: 'Ticket' }), ticketController.patchTicket);
router.delete('/:id', authMw, roleMw('admin'), byIdEventAccess('help_tickets', { label: 'Ticket' }), ticketController.deleteTicket);

module.exports = router;
