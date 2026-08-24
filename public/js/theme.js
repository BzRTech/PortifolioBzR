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
    var current = document.documentElement.getAttribute('data-theme') || 'dark';
    _bzrApplyTheme(current === 'dark' ? 'light' : 'dark');
  }
};

document.addEventListener('DOMContentLoaded', function() {
  // Sem preferencia salva, a plataforma abre no escuro (mesmo tema da landing).
  var saved = localStorage.getItem(_BZR_THEME_KEY) || 'dark';
  _bzrApplyTheme(saved);
});
