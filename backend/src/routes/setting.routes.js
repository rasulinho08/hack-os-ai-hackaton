const express = require('express');
const settingController = require('../controllers/setting.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');

const { rowInEvent } = require('../middlewares/eventAccess');
const router = express.Router({ mergeParams: true });

router.get('/', authMw, roleMw('admin'), settingController.getSettings);
router.put('/', authMw, roleMw('admin'), settingController.upsertSettings);
router.delete('/:id', authMw, roleMw('admin'), rowInEvent('event_settings', 'Setting'), settingController.deleteSetting);

module.exports = router;
