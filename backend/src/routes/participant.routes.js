const router = require('express').Router({ mergeParams: true });
const participantController = require('../controllers/participant.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const { exportLimiter } = require('../middlewares/authRateLimit');

// Self-registration: ONLY hackers can register themselves as participants
// Security: roleMw('hacker') ensures admins/judges/mentors cannot self-register
// Use registerSelf (the richer handler that honors `is_solo` from the body).
// `selfRegister` was a duplicate stub that ignored the body — removing it.
router.post('/self', authMw, roleMw('hacker'), participantController.registerSelf);

router.get(
  '/lobby-hackers',
  authMw,
  roleMw('hacker'),
  participantController.listLobbyHackers,
);

router.get(
  '/lobby-self-approval',
  authMw,
  roleMw('hacker'),
  participantController.getLobbySelfApproval,
);

// Organisers: capacity, bulk changes, whole teams, the waiting list, the export.
router.get('/summary', authMw, roleMw('admin'), participantController.summary);
router.get('/unassigned', authMw, roleMw('admin'), participantController.unassigned);
router.get('/export.csv', authMw, roleMw('admin'), exportLimiter, participantController.exportCsv);
router.post('/bulk', authMw, roleMw('admin'), participantController.bulkStatus);
router.post('/promote', authMw, roleMw('admin'), participantController.promote);
router.post('/team/:teamId/status', authMw, roleMw('admin'), participantController.teamStatus);

router.get('/', authMw, roleMw('admin', 'mentor', 'judge', 'volunteer'), participantController.getParticipants);
router.get('/:id', authMw, roleMw('admin', 'mentor', 'judge', 'volunteer'), participantController.getParticipantById);
router.post('/', authMw, roleMw('admin'), participantController.addParticipant);
router.patch('/:id', authMw, roleMw('admin'), participantController.updateParticipantStatus);
router.delete('/:id', authMw, roleMw('admin'), participantController.deleteParticipant);
router.post('/:id/eliminate', authMw, roleMw('admin'), participantController.eliminateParticipant);

module.exports = router;
