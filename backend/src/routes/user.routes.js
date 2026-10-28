const express = require('express');
const userController = require('../controllers/user.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');

const router = express.Router();

router.post('/bulk-import', authMw, roleMw('admin'), userController.bulkImport);
router.post('/', authMw, roleMw('admin'), userController.createUser);
router.get('/', authMw, roleMw('admin'), userController.getUsers);
router.get('/:id', authMw, roleMw('admin', 'mentor', 'judge'), userController.getUserById);
router.patch('/:id', authMw, userController.updateUser);
router.delete('/:id', authMw, roleMw('admin'), userController.deleteUser);
router.patch('/:id/role', authMw, roleMw('admin'), userController.changeUserRole);
// Admin sets a (temporary) password — e.g. for accounts created by CSV import
router.patch('/:id/password', authMw, roleMw('admin'), userController.setPassword);

module.exports = router;
