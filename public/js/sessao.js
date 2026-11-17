// Sessão e módulos — carregado no <head> de todas as páginas.
//  1) Envia o token (Authorization: Bearer) em toda chamada fetch para /api/…
//     da própria origem, e leva ao /login quando a API responde 401
//     (Território, O.S. e importação passaram a exigir login).
//  2) Esconde links de módulos desligados nesta instalação (GET /api/modulos).
//  3) Marca <html data-perfil="…"> para o perfil "gestor" (somente leitura).
(function () {
  var TOKEN_KEY = 'bzr_token';
  var LIVRES = ['/api/auth/login', '/api/auth/config', '/api/publico', '/api/modulos', '/api/health', '/api/config'];
  var nativo = window.fetch.bind(window);

  function caminho(url) {
    try { var u = new URL(url, location.href); return u.origin === location.origin ? u.pathname : null; } catch (e) { return null; }
  }
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var p = caminho(url);
    if (!p || p.indexOf('/api/') !== 0) return nativo(input, init);
    init = init || {};
    var token = null;
    try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { /* sem storage */ }
    var h = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
    if (token && !h.has('Authorization')) h.set('Authorization', 'Bearer ' + token);
    init.headers = h;
    return nativo(input, init).then(function (r) {
      var livre = LIVRES.some(function (x) { return p.indexOf(x) === 0; });
      if (r.status === 401 && !livre && location.pathname !== '/login') {
        try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ok */ }
        location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search + location.hash));
      }
      return r;
    });
  };

  // Perfil (lido do token, só para a interface; quem decide é a API).
  try {
    var t = localStorage.getItem(TOKEN_KEY);
    if (t) {
      var claims = JSON.parse(atob(t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
      if (claims && claims.role) document.documentElement.setAttribute('data-perfil', claims.role);
    }
  } catch (e) { /* token ilegível */ }

  // Módulos ativos.
  var MOD_DE = [['/os/dashboard-waze', 'waze'], ['/territorio', 'territorio'], ['/importar', 'territorio'], ['/cib', 'cib'], ['/documentos', 'documentos'],
    ['/validar', 'documentos'], ['/bci', 'bci'], ['/demandas', 'demandas'], ['/os', 'os']];
  function moduloDo(href) {
    var p = caminho(href);
    if (!p) return null;
    for (var i = 0; i < MOD_DE.length; i++) if (p === MOD_DE[i][0] || p.indexOf(MOD_DE[i][0] + '/') === 0 || p.indexOf(MOD_DE[i][0] + '.') === 0) return MOD_DE[i][1];
    return null;
  }
  nativo('/api/modulos').then(function (r) { return r.ok ? r.json() : null; }).then(function (cfg) {
    if (!cfg || !cfg.modulos) return;
    window.BZR_MODULOS = cfg.modulos;
    var esconder = function () {
      document.querySelectorAll('a[href]').forEach(function (a) {
        var m = moduloDo(a.getAttribute('href'));
        if (m && cfg.modulos.indexOf(m) < 0) a.style.display = 'none';
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', esconder); else esconder();
  }).catch(function () { /* sem rede: mantém os links */ });
})();
