const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { isAuthenticated } = require('../middleware/auth');

// Multer — save directly to public/images/logo.png
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../public/images');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Always save as logo.png (overwrite)
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'logo' + (ext || '.png'));
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (/\.(png|jpg|jpeg|svg|gif)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only image files allowed (PNG, JPG, SVG, GIF)'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

// GET /admin/settings
router.get('/', isAuthenticated, (req, res) => {
  res.render('admin/settings', {
    title: 'Settings',
    adminName: req.session.adminName,
    error:   req.flash('error'),
    success: req.flash('success')
  });
});

// POST /admin/settings/upload-logo
router.post('/upload-logo', isAuthenticated, upload.single('logo'), (req, res) => {
  try {
    if (!req.file) {
      req.flash('error', 'No file uploaded.');
      return res.redirect('/admin/settings');
    }
    // Also regenerate the base64 for PDF embedding
    const logoPath = req.file.path;
    const b64 = fs.readFileSync(logoPath).toString('base64');
    const b64File = path.join(__dirname, '../data/logoBase64.js');
    fs.writeFileSync(b64File, `module.exports = "${b64}";`);

    req.flash('success', `Logo updated successfully (${req.file.filename}). All pages now use the new logo.`);
    res.redirect('/admin/settings');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/settings');
  }
});

// GET /admin/settings/logo-status (AJAX)
router.get('/logo-status', isAuthenticated, (req, res) => {
  const logoPath = path.join(__dirname, '../../public/images/logo.png');
  const exists   = fs.existsSync(logoPath);
  const size     = exists ? (fs.statSync(logoPath).size / 1024).toFixed(1) + ' KB' : '—';
  res.json({ exists, size, path: '/images/logo.png' });
});

module.exports = router;
