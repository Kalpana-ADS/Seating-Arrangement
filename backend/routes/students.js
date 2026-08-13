const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { uploadDataset, getStudents, deleteStudent, clearAllStudents } = require('../controllers/studentController');

router.get('/', isAuthenticated, getStudents);
router.post('/upload', isAuthenticated, upload.single('dataset'), uploadDataset);
router.post('/delete/:id', isAuthenticated, deleteStudent);
router.post('/clear', isAuthenticated, clearAllStudents);

module.exports = router;
