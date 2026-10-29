const express = require('express');
const fileController = require('../controllers/file.controller');
const authMw = require('../middlewares/authMw');
const { uploadLimiter } = require('../middlewares/authRateLimit');
const { MAX_UPLOAD_BYTES } = require('../services/file.service');

const { optionalAuthMw } = authMw;
const router = express.Router();

// The body is the file itself; what it is gets decided from its bytes.
const rawBody = express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES + 64 * 1024 });

router.post('/', optionalAuthMw, uploadLimiter, rawBody, fileController.upload);
router.get('/:id', optionalAuthMw, fileController.read);
router.delete('/:id', authMw, fileController.remove);

module.exports = router;
