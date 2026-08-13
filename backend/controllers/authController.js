const Admin = require('../models/Admin');

const showLogin = (req, res) => {
  if (req.session.adminId) return res.redirect('/admin/dashboard');
  res.render('admin/login', {
    title: 'Admin Login',
    error: req.flash('error'),
    success: req.flash('success')
  });
};

const login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      req.flash('error', 'Username and password are required.');
      return res.redirect('/admin/login');
    }
    const admin = await Admin.findOne({ username: username.trim() });
    if (!admin) {
      req.flash('error', 'Invalid username or password.');
      return res.redirect('/admin/login');
    }
    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      req.flash('error', 'Invalid username or password.');
      return res.redirect('/admin/login');
    }
    req.session.adminId = admin._id;
    req.session.adminName = admin.fullName;
    req.flash('success', 'Login successful!');
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    req.flash('error', 'Server error. Please try again.');
    res.redirect('/admin/login');
  }
};

const logout = (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
};

module.exports = { showLogin, login, logout };
