const express = require('express');
const judgeController = require('../controllers/judge.controller');
const judging = require('../controllers/judging.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');

const { participantsOnly } = require('../middlewares/eventAccess');
const router = express.Router({ mergeParams: true });

// Judge assignments — admins manage, any authenticated user can view who judges
router.get('/judges', authMw, roleMw('admin', 'judge', 'mentor', 'hacker'), participantsOnly, judgeController.getJudges);
router.post('/judges', authMw, roleMw('admin'), judgeController.assignJudge);
router.patch('/judges/:id', authMw, roleMw('admin'), judging.setTrack);
router.delete('/judges/:id', authMw, roleMw('admin'), judgeController.removeJudge);

// The judge portal: assigned teams (blind when set), one review at a time,
// the conflict-of-interest declaration and conflicts with single teams.
router.get('/me', authMw, roleMw('judge'), judging.me);
router.post('/me/reviews', authMw, roleMw('judge'), judging.saveReview);
router.post('/me/coi', authMw, roleMw('judge'), judging.confirmCoi);
router.post('/me/conflicts', authMw, roleMw('judge'), judging.declareMine);
router.delete('/me/conflicts/:teamId', authMw, roleMw('judge'), judging.clearMine);

// Organiser: conflicts, who judges which team, and the progress matrix.
router.get('/conflicts', authMw, roleMw('admin'), judging.listConflicts);
router.post('/conflicts', authMw, roleMw('admin'), judging.declareFor);
router.delete('/conflicts/:id', authMw, roleMw('admin'), judging.clearById);
router.get('/assignments', authMw, roleMw('admin'), judging.listAssignments);
router.post('/assignments/generate', authMw, roleMw('admin'), judging.generate);
router.put('/assignments/:judgeId', authMw, roleMw('admin'), judging.setForJudge);
router.get('/progress', authMw, roleMw('admin'), judging.progress);
// Judge audit (every score given or changed) and the GitHub check.
router.get('/history', authMw, roleMw('admin'), judging.history);
router.get('/repo-checks', authMw, roleMw('admin'), judging.repoChecks);
router.post('/repo-checks', authMw, roleMw('admin'), judging.runRepoChecks);

// Scoring criteria — readable by judges+admins; writable by admin only
router.get('/criteria', authMw, roleMw('admin', 'judge'), judgeController.getCriteria);
router.put('/criteria', authMw, roleMw('admin'), judgeController.replaceCriteria);
router.post('/criteria', authMw, roleMw('admin'), judgeController.createCriterion);
router.put('/criteria/:id', authMw, roleMw('admin'), judgeController.updateCriterion);
router.delete('/criteria/:id', authMw, roleMw('admin'), judgeController.deleteCriterion);

// Scores — only judges/admins can view or submit scores
router.get('/scores', authMw, roleMw('admin', 'judge'), judgeController.getScores);
router.post('/scores', authMw, roleMw('judge', 'admin'), judgeController.submitScore);
router.put('/scores/:id', authMw, roleMw('judge', 'admin'), judgeController.updateScore);

// Leaderboard — organisers live; others only once published with the full leaderboard visible
router.get('/leaderboard', authMw, participantsOnly, judgeController.getLeaderboard);

module.exports = router;

