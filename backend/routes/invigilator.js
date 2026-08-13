const express = require('express');
const router  = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const C = require('../controllers/invigilatorController');

router.get('/',             isAuthenticated, C.getPage);
router.get('/eligible',     isAuthenticated, C.getEligible);
router.get('/duty-check',   isAuthenticated, C.getDutyCheck);
router.get('/subjects',     isAuthenticated, C.getSubjects);
router.post('/save',        isAuthenticated, C.saveAllocation);
router.post('/update/:id',  isAuthenticated, C.updateAllocation);
router.post('/delete/:id',  isAuthenticated, C.deleteAllocation);
router.get('/view/:id',     isAuthenticated, C.viewAllocation);
router.get('/download/:id', isAuthenticated, C.downloadPDF);

module.exports = router;
