const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.adminId) {
    return next();
  }

  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(401).json({
      success: false,
      message: 'Please login to access the admin panel.'
    });
  }

  req.flash('error', 'Please login to access the admin panel.');
  return res.redirect('/admin/login');
};

module.exports = { isAuthenticated };
