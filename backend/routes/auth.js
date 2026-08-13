const express = require('express');
const router = express.Router();
const { showLogin, login, logout } = require('../controllers/authController');

router.get('/login', showLogin);
router.post('/login', login);
router.get('/logout', logout);

module.exports = router;
