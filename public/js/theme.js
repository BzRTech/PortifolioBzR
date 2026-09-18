var _BZR_THEME_KEY = 'bzr-theme';

function _bzrApplyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(_BZR_THEME_KEY, theme);
  document.querySelectorAll('[data-theme-toggle]').forEach(function(btn) {
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    btn.title = theme === 'dark' ? 'Modo claro' : 'Modo escuro';
  });
}

window.BzrTheme = {
  toggle: function() {
    var current = document.documentElement.getAttribute('data-theme') || 'light';
    _bzrApplyTheme(current === 'dark' ? 'light' : 'dark');
  }
};

document.addEventListener('DOMContentLoaded', function() {
  var saved = localStorage.getItem(_BZR_THEME_KEY) || 'light';
  _bzrApplyTheme(saved);
});
