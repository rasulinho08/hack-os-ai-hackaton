const express = require('express');
const voting = require('../controllers/voting.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const { participantsOnly } = require('../middlewares/eventAccess');

const router = express.Router({ mergeParams: true });

router.get('/', authMw, roleMw('admin'), voting.tally);
router.get('/me', authMw, participantsOnly, voting.mine);
router.post('/me', authMw, participantsOnly, voting.vote);
router.delete('/me', authMw, participantsOnly, voting.withdraw);

module.exports = router;
