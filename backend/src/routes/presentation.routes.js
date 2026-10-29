const { rowInEvent, participantsOnly } = require('../middlewares/eventAccess');
const router = require('express').Router({ mergeParams: true });
const presentationController = require('../controllers/presentation.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');

router.get('/', authMw, participantsOnly, presentationController.getPresentations);
router.get('/settings', authMw, participantsOnly, presentationController.getSettings);
router.post('/generate', authMw, roleMw('admin'), presentationController.generatePresentations);
router.put('/reorder', authMw, roleMw('admin'), presentationController.reorderPresentations);
router.post('/', authMw, roleMw('admin'), presentationController.createPresentation);
router.patch('/:id', authMw, roleMw('admin'), rowInEvent('presentations', 'Presentation'), presentationController.updatePresentation);
router.delete('/:id', authMw, roleMw('admin'), rowInEvent('presentations', 'Presentation'), presentationController.deletePresentation);

module.exports = router;
