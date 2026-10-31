const express = require('express');
const gallery = require('../controllers/gallery.controller');
const authMw = require('../middlewares/authMw');

// Mounted at /api/events/:eventId/gallery behind eventExists, eventAccess and
// the plan's 'gallery' module (app.js).
const router = express.Router({ mergeParams: true });

router.get('/', authMw, gallery.get);
router.post('/', authMw, gallery.add);
router.post('/share', authMw, gallery.share);
router.patch('/:photoId', authMw, gallery.update);
router.delete('/:photoId', authMw, gallery.remove);

// Mounted at /api/gallery: the link people get points at the event's address.
const bySlug = express.Router();
bySlug.get('/:slug', authMw, gallery.getBySlug);

module.exports = { router, bySlug };
