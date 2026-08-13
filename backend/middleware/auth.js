const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.adminId) {
    return next();
  }
  req.flash('error', 'Please login to access the admin panel.');
  res.redirect('/admin/login');
};

module.exports = { isAuthenticated };
