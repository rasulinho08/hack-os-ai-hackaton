const express = require('express');
const feedbackController = require('../controllers/feedback.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');

const { rowInEvent, participantsOnly } = require('../middlewares/eventAccess');
const router = express.Router({ mergeParams: true });

router.get('/', authMw, roleMw('admin'), feedbackController.getFeedback);
router.get('/mine', authMw, feedbackController.getMyFeedback);
router.get('/nps', authMw, roleMw('admin'), feedbackController.npsSummary);
router.get('/nps/mine', authMw, participantsOnly, feedbackController.myNps);
router.post('/nps', authMw, participantsOnly, feedbackController.saveNps);
router.post('/', authMw, participantsOnly, feedbackController.createFeedback);
router.delete('/:id', authMw, roleMw('admin'), rowInEvent('feedback', 'Feedback'), feedbackController.deleteFeedback);

module.exports = router;
