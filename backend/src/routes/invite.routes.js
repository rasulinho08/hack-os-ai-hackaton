const express = require('express');
const inviteController = require('../controllers/invite.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');

const router = express.Router({ mergeParams: true });

router.get('/', authMw, roleMw('admin'), inviteController.list);
router.post('/', authMw, roleMw('admin'), inviteController.add);
router.get('/:id/link', authMw, roleMw('admin'), inviteController.link);
router.delete('/:id', authMw, roleMw('admin'), inviteController.remove);

module.exports = router;
