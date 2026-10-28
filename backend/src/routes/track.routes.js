const express = require('express');
const trackController = require('../controllers/track.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');

const { rowInEvent } = require('../middlewares/eventAccess');
const router = express.Router({ mergeParams: true });

router.get('/', authMw, trackController.getTracks);
router.post('/', authMw, roleMw('admin'), trackController.createTrack);
router.put('/:id', authMw, roleMw('admin'), rowInEvent('tracks', 'Track'), trackController.updateTrack);
router.delete('/:id', authMw, roleMw('admin'), rowInEvent('tracks', 'Track'), trackController.deleteTrack);

module.exports = router;
