const express = require('express');
const elimination = require('../controllers/elimination.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');

const router = express.Router({ mergeParams: true });

router.get('/rounds', authMw, roleMw('admin'), elimination.list);
router.post('/rounds', authMw, roleMw('admin'), elimination.create);
router.patch('/rounds/:id', authMw, roleMw('admin'), elimination.update);
router.delete('/rounds/:id', authMw, roleMw('admin'), elimination.remove);
router.post('/rounds/:id/eliminate', authMw, roleMw('admin'), elimination.eliminate);
router.post('/teams/:teamId/restore', authMw, roleMw('admin'), elimination.restore);
router.get('/suggest', authMw, roleMw('admin'), elimination.suggest);

module.exports = router;
