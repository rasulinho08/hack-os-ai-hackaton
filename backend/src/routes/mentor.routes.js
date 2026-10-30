const express = require('express');
const mentorController = require('../controllers/mentor.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');

const { rowInEvent, participantsOnly } = require('../middlewares/eventAccess');
const router = express.Router({ mergeParams: true });

router.get('/', authMw, participantsOnly, mentorController.getMentors);
router.post('/', authMw, roleMw('admin'), mentorController.assignMentor);

// The calling mentor (before '/:id' so "me" and "slots" are not read as ids).
router.get('/me', authMw, roleMw('mentor'), mentorController.getMine);
router.patch('/me', authMw, roleMw('mentor'), mentorController.updateMine);
router.post('/me/heartbeat', authMw, roleMw('mentor'), mentorController.heartbeat);

// Hours mentors are around: everyone in the event may read them.
router.get('/slots', authMw, participantsOnly, mentorController.listSlots);
router.post('/slots', authMw, roleMw('mentor', 'admin'), mentorController.createSlot);
router.delete('/slots/:slotId', authMw, roleMw('mentor', 'admin'), mentorController.deleteSlot);

router.put('/:id', authMw, roleMw('admin'), rowInEvent('mentor_assignments', 'Mentor'), mentorController.updateMentor);
router.delete('/:id', authMw, roleMw('admin'), rowInEvent('mentor_assignments', 'Mentor'), mentorController.removeMentor);

module.exports = router;
