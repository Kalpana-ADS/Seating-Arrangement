// ============================================================
// Panimalar Engineering College — Exam Seating System
// Main JavaScript
// ============================================================

// Sidebar toggle for mobile
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.classList.toggle('open');
}

// Close sidebar on outside click (mobile)
document.addEventListener('click', function (e) {
  const sidebar = document.querySelector('.sidebar');
  const toggle = document.querySelector('.sidebar-toggle');
  if (
    sidebar &&
    sidebar.classList.contains('open') &&
    !sidebar.contains(e.target) &&
    toggle &&
    !toggle.contains(e.target)
  ) {
    sidebar.classList.remove('open');
  }
});

// Auto-dismiss alerts after 5 seconds
document.addEventListener('DOMContentLoaded', function () {
  const alerts = document.querySelectorAll('.alert');
  alerts.forEach(function (alert) {
    setTimeout(function () {
      alert.style.transition = 'opacity 0.5s ease';
      alert.style.opacity = '0';
      setTimeout(function () { alert.remove(); }, 500);
    }, 5000);
  });
});

// Confirm before form delete actions (backup)
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      const msg = form.getAttribute('data-confirm') || 'Are you sure?';
      if (!confirm(msg)) e.preventDefault();
    });
  });
});

// Active nav link highlight on public pages
document.addEventListener('DOMContentLoaded', function () {
  const links = document.querySelectorAll('.nav-link');
  links.forEach(function (link) {
    if (link.href === window.location.href) {
      link.classList.add('active');
    }
  });
});

// Animate stat numbers on dashboard
document.addEventListener('DOMContentLoaded', function () {
  const statNumbers = document.querySelectorAll('.stat-number');
  statNumbers.forEach(function (el) {
    const target = parseInt(el.textContent, 10);
    if (isNaN(target)) return;
    let count = 0;
    const step = Math.ceil(target / 40);
    const timer = setInterval(function () {
      count += step;
      if (count >= target) { count = target; clearInterval(timer); }
      el.textContent = count;
    }, 25);
  });
});
