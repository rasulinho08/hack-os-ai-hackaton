const express = require('express');
const sponsorController = require('../controllers/sponsor.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');

const { rowInEvent } = require('../middlewares/eventAccess');
const router = express.Router({ mergeParams: true });

// Organisers only: the public event page carries its sponsors itself, and this
// list (drafts included) was readable by anyone who guessed an event id.
router.get('/', authMw, roleMw('admin'), sponsorController.getSponsors);
router.post('/', authMw, roleMw('admin'), sponsorController.createSponsor);
router.put('/:id', authMw, roleMw('admin'), rowInEvent('sponsors', 'Sponsor'), sponsorController.updateSponsor);
router.delete('/:id', authMw, roleMw('admin'), rowInEvent('sponsors', 'Sponsor'), sponsorController.deleteSponsor);

module.exports = router;
