const express = require('express');
const router  = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const C = require('../controllers/attendanceController');

router.get('/',                        isAuthenticated, C.getPage);
router.get('/search',                  isAuthenticated, C.search);
router.post('/session/create',         isAuthenticated, C.createSession);
router.get('/session/:id',             isAuthenticated, C.getSessionPage);
router.post('/mark-absent',            isAuthenticated, C.markAbsent);
router.post('/undo-absent',            isAuthenticated, C.undoAbsent);
router.post('/edit-record',            isAuthenticated, C.editRecord);
router.post('/mark-od',                isAuthenticated, C.markOD);
router.post('/mark-all-present',       isAuthenticated, C.markAllPresent);
router.post('/delete-session/:id',     isAuthenticated, C.deleteSession);
router.get('/download/:id',            isAuthenticated, C.downloadPDF);
router.post('/dataset/upload',         isAuthenticated, C.uploadMiddleware, C.uploadDataset);
router.post('/dataset/reseed',         isAuthenticated, C.reseedAll);

module.exports = router;
