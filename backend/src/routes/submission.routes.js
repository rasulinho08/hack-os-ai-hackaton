const express = require('express');
const submissionController = require('../controllers/submission.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const { byIdEventAccess } = require('../middlewares/eventAccess');

const router = express.Router();

router.post('/', authMw, roleMw('hacker'), submissionController.submitProject);
// Before '/:id': what this event asks a team to hand in.
router.get('/rules', authMw, submissionController.getRules);
router.get(
  '/',
  authMw,
  roleMw('hacker', 'judge', 'admin', 'mentor'),
  submissionController.getAllSubmissions
);
router.get(
  '/:id',
  authMw,
  roleMw('hacker', 'judge', 'admin', 'mentor'),
  byIdEventAccess('submissions', { label: 'Submission' }),
  submissionController.getSubmissionById
);
router.put(
  '/:id',
  authMw,
  roleMw('hacker', 'admin'),
  byIdEventAccess('submissions', { label: 'Submission' }),
  submissionController.updateSubmission
);
router.delete('/:id', authMw, roleMw('admin'), byIdEventAccess('submissions', { label: 'Submission' }), submissionController.deleteSubmission);

module.exports = router;
