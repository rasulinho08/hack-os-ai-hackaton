const express = require('express');
const prizeController = require('../controllers/prize.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');

const { rowInEvent, participantsOnly } = require('../middlewares/eventAccess');
const router = express.Router({ mergeParams: true });

// A participant reads the prizes of their own events only (the public page
// shows a published event's prizes to everyone).
router.get('/', authMw, participantsOnly, prizeController.getPrizes);
router.post('/', authMw, roleMw('admin'), prizeController.createPrize);
router.put('/:id', authMw, roleMw('admin'), rowInEvent('prizes', 'Prize'), prizeController.updatePrize);
router.delete('/:id', authMw, roleMw('admin'), rowInEvent('prizes', 'Prize'), prizeController.deletePrize);

module.exports = router;
