const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const Admin   = require('../models/Admin');
const { isAuthenticated } = require('../middleware/auth');

// List admins
router.get('/admins', isAuthenticated, async (req, res) => {
  try {
    const admins = await Admin.find().select('-password').sort({ createdAt: 1 });
    res.render('admin/admins', {
      title: 'Manage Admin Users',
      admins,
      adminName: req.session.adminName,
      error:   req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/dashboard');
  }
});

// Add new admin
router.post('/admins/add', isAuthenticated, async (req, res) => {
  try {
    const { username, password, fullName, role } = req.body;
    if (!username || !password) {
      req.flash('error', 'Username and password are required.');
      return res.redirect('/admin/admins');
    }
    const exists = await Admin.findOne({ username: username.trim() });
    if (exists) {
      req.flash('error', `Username "${username}" already exists.`);
      return res.redirect('/admin/admins');
    }
    await Admin.create({ username: username.trim(), password, fullName: fullName || username, role: role || 'staff' });
    req.flash('success', `Admin "${username}" created successfully.`);
    res.redirect('/admin/admins');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/admins');
  }
});

// Change password (own or by superadmin via AJAX)
router.post('/admins/change-password', isAuthenticated, async (req, res) => {
  try {
    const { adminId, currentPassword, newPassword } = req.body;
    const id = adminId || req.session.adminId;
    const admin = await Admin.findById(id);
    if (!admin) return res.json({ success: false, message: 'Admin not found.' });

    // If changing own password, verify current
    if (String(id) === String(req.session.adminId)) {
      const ok = await admin.comparePassword(currentPassword);
      if (!ok) return res.json({ success: false, message: 'Current password is incorrect.' });
    }

    admin.password = newPassword;
    await admin.save();
    return res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
});

// Change username (AJAX)
router.post('/admins/change-username', isAuthenticated, async (req, res) => {
  try {
    const { adminId, newUsername } = req.body;
    const id = adminId || req.session.adminId;
    if (!newUsername) return res.json({ success: false, message: 'New username required.' });
    const exists = await Admin.findOne({ username: newUsername.trim(), _id: { $ne: id } });
    if (exists) return res.json({ success: false, message: 'Username already taken.' });
    const admin = await Admin.findByIdAndUpdate(id, { username: newUsername.trim() }, { new: true });
    if (String(id) === String(req.session.adminId)) req.session.adminName = admin.fullName;
    return res.json({ success: true, message: `Username changed to "${newUsername}".` });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
});

// Delete admin
router.post('/admins/delete/:id', isAuthenticated, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.session.adminId)) {
      req.flash('error', 'You cannot delete your own account.');
      return res.redirect('/admin/admins');
    }
    await Admin.findByIdAndDelete(req.params.id);
    req.flash('success', 'Admin account deleted.');
    res.redirect('/admin/admins');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/admins');
  }
});

module.exports = router;
