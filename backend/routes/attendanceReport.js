const express = require('express');
const router  = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const C = require('../controllers/attendanceReportController');

router.get('/',             isAuthenticated, C.getPage);
router.get('/pdf',          isAuthenticated, C.downloadPDF);

module.exports = router;
