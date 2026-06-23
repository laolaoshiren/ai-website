/* Theme Toggle - localStorage persistence */
(function() {
  var saved = localStorage.getItem('theme');
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  document.addEventListener('DOMContentLoaded', function() {
    var icon = document.querySelector('.theme-icon');
    if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
  });
})();

function toggleTheme() {
  var html = document.documentElement;
  var current = html.getAttribute('data-theme');
  var next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  var icon = document.querySelector('.theme-icon');
  if (icon) icon.textContent = next === 'dark' ? '☀️' : '🌙';
}

/* Mobile nav toggle */
function toggleNav() {
  var nav = document.getElementById('main-nav');
  var overlay = document.getElementById('nav-overlay');
  if (!nav || !overlay) return;
  nav.classList.toggle('open');
  overlay.classList.toggle('active');
  document.body.style.overflow = overlay.classList.contains('active') ? 'hidden' : '';
}
