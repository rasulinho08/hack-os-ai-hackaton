const express = require('express');
const certificates = require('../controllers/certificate.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');

const router = express.Router({ mergeParams: true });

router.get('/', authMw, roleMw('admin'), certificates.list);
router.get('/plan', authMw, roleMw('admin'), certificates.plan);
router.post('/issue', authMw, roleMw('admin'), certificates.issue);
router.post('/email', authMw, roleMw('admin'), certificates.email);
router.post('/:id/revoke', authMw, roleMw('admin'), certificates.revoke);
router.post('/:id/restore', authMw, roleMw('admin'), certificates.restore);
// The holder may download their own; the controller checks it is theirs.
router.get('/:id/pdf', authMw, certificates.pdf);

module.exports = router;
