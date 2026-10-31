const express = require('express');
const resourceController = require('../controllers/resource.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');

const { rowInEvent, participantsOnly } = require('../middlewares/eventAccess');
const router = express.Router({ mergeParams: true });

// Read — available to all authenticated event staff + hackers
router.get('/', authMw, participantsOnly, resourceController.getResources);

// Write — admin/organizer only
router.post('/',     authMw, roleMw('admin'), resourceController.addResource);
router.put('/bulk',  authMw, roleMw('admin'), resourceController.bulkReplace);
router.patch('/:id', authMw, roleMw('admin'), rowInEvent('event_resources', 'Resource'), resourceController.updateResource);
router.delete('/:id', authMw, roleMw('admin'), rowInEvent('event_resources', 'Resource'), resourceController.deleteResource);

module.exports = router;
