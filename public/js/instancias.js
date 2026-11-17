// Troca de município entre instâncias (cada prefeitura tem o seu deploy e o
// seu banco — docs/adr/0002-troca-de-municipio.md).
//
// Quando a instância está travada num município (MUNICIPIO) e a equipe atende
// outras prefeituras (INSTANCIAS), o seletor do topo lista todas: escolher
// outra leva para o endereço dela. Com SSO_SECRET, entra direto (ticket de
// 60 s, uso único); sem, pede o login de lá. O perfil é o de cada prefeitura.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const I = {};

  /** {atual:{municipio,url}, outras:[{municipio,url}], sso} ou null. */
  I.carregar = async function () {
    try { const r = await fetch('/api/instancias'); return r.ok ? await r.json() : null; } catch { return null; }
  };

  I.trocar = async function (inst, sso) {
    const next = location.pathname + location.search + location.hash;
    if (sso) {
      try {
        const r = await fetch('/api/sso/emitir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destino: inst.url }) });
        const j = await r.json();
        if (r.ok) { location.href = j.url + '&next=' + encodeURIComponent(next); return; }
        console.warn('[instancias]', j.error);
      } catch (e) { console.warn('[instancias]', e); }
    }
    location.href = inst.url + '/login?next=' + encodeURIComponent(next);
  };

  /**
   * Preenche o <select> no modo "uma instância por município". Devolve false
   * quando a instância não está travada (demonstração: o seletor local segue).
   */
  I.montar = async function (sel, dados) {
    const d = dados || (await I.carregar());
    if (!d || !d.atual || !d.atual.municipio) return false;
    if (!sel) return true;
    const outras = d.outras || [];
    sel.innerHTML = `<option value="" selected>${esc(d.atual.municipio)}</option>`
      + (outras.length ? `<optgroup label="Trocar de município">${outras.map((o, i) => `<option value="${i}">${esc(o.municipio)} ↗</option>`).join('')}</optgroup>` : '');
    sel.disabled = !outras.length;
    sel.title = outras.length ? `Município — ${outras.length + 1} prefeituras${d.sso ? ' (troca sem nova senha)' : ''}` : 'Município desta instalação';
    sel.onchange = () => {
      const o = outras[Number(sel.value)];
      if (!o) return;
      sel.disabled = true;
      I.trocar(o, d.sso);
    };
    return true;
  };

  window.BzrInstancias = I;
})();
