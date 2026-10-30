const express = require('express');
const announcementController = require('../controllers/announcement.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const requireModule = require('../middlewares/requireModule');
const { byIdEventAccess } = require('../middlewares/eventAccess');

const router = express.Router();
const ownAnnouncement = byIdEventAccess('announcements', { label: 'Announcement' });

router.get('/', authMw, announcementController.getAnnouncements);
router.get('/audience', authMw, roleMw('admin'), announcementController.audienceSize);
router.post('/', authMw, roleMw('admin'), requireModule('announcements'), announcementController.createAnnouncement);
router.put('/:id', authMw, roleMw('admin'), byIdEventAccess('announcements', { label: 'Announcement' }), announcementController.updateAnnouncement);
router.delete('/:id', authMw, roleMw('admin'), byIdEventAccess('announcements', { label: 'Announcement' }), announcementController.deleteAnnouncement);
router.post('/:id/cancel', authMw, roleMw('admin'), ownAnnouncement, announcementController.cancelAnnouncement);
router.post('/:id/send-now', authMw, roleMw('admin'), ownAnnouncement, announcementController.sendNow);
router.get('/:id/deliveries', authMw, roleMw('admin'), ownAnnouncement, announcementController.getDeliveries);

module.exports = router;
