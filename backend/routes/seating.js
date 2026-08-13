const express = require('express');
const router  = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const {
  getDashboard, getSeatingManage, generateSeating, addSeatingRow, getRemaining,
  updateSeating, deleteSeating, clearSeating,
  getPublicSeating, getHallSheet, getDeptNotice,
  exportPDF, exportHallPDF, exportDeptNoticePDF
} = require('../controllers/seatingController');

// ── Admin routes ────────────────────────────────────────────
router.get('/dashboard',               isAuthenticated, getDashboard);
router.get('/remaining',               isAuthenticated, getRemaining);
router.get('/seating',                 isAuthenticated, getSeatingManage);
router.post('/seating/generate',       isAuthenticated, generateSeating);
router.post('/seating/add-row',        isAuthenticated, addSeatingRow);
router.post('/seating/update/:id',     isAuthenticated, updateSeating);   // inline edit
router.post('/seating/delete/:id',     isAuthenticated, deleteSeating);
router.post('/seating/clear',          isAuthenticated, clearSeating);
router.get('/seating/export/:year',    isAuthenticated, exportPDF);
router.get('/hallsheet/:hall',         isAuthenticated, getHallSheet);
router.get('/hallsheet/pdf/:hall',     isAuthenticated, exportHallPDF);
router.get('/deptnotice',              isAuthenticated, getDeptNotice);
router.get('/deptnotice/pdf',          isAuthenticated, exportDeptNoticePDF);

// ── Public routes ────────────────────────────────────────────
router.get('/view/:year',              getPublicSeating);
router.get('/export/public/:year',     exportPDF);

module.exports = router;
