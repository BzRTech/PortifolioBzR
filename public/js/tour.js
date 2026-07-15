// Motor de "Tour guiado" (modo apresentação) reutilizável — sem dependências.
// Injeta o próprio CSS e cria: botão flutuante 🎓 (liga/desliga), spotlight
// (foco) sobre o elemento explicado, balão com texto em linguagem simples,
// navegação passo a passo e um aviso de boas-vindas na 1ª visita (lembrado no
// localStorage). Feito para o tema dark BzR.
//
// Uso (no fim da página):
//   <script src="/js/tour.js"></script>
//   <script>BzrTour.init({ id:'territorio', title:'Bem-vindo ao BzR',
//     intro:'...', fabPos:'bottom-left', steps:[{sel:'#map',title:'',text:''}, ...] });</script>
(function () {
  const CSS = `
  .bzrt-fab{position:fixed;z-index:99998;display:inline-flex;align-items:center;gap:8px;border:none;
    cursor:pointer;border-radius:999px;padding:11px 16px;font-weight:800;font-size:13.5px;
    font-family:inherit;background:linear-gradient(135deg,#1FBF63,#4EDB8D);color:#04140B;
    box-shadow:0 8px 22px rgba(31,191,99,.4)}
  .bzrt-fab.left{left:16px;bottom:16px}.bzrt-fab.right{right:16px;bottom:16px}
  .bzrt-fab.on{background:#1A2318;color:#F1F5F2;border:1px solid #2A362E;box-shadow:none}
  .bzrt-ov{position:fixed;inset:0;z-index:99999;display:none}
  .bzrt-ov.show{display:block}
  .bzrt-svg{position:fixed;inset:0;pointer-events:none}
  .bzrt-svg rect.dim{fill:rgba(3,6,4,.74)}
  .bzrt-skip{position:fixed;top:14px;right:14px;z-index:100001;background:rgba(10,15,12,.82);
    border:1px solid #2A362E;color:#9AA6A0;border-radius:8px;padding:7px 12px;font-size:12.5px;
    font-weight:600;cursor:pointer;font-family:inherit}
  .bzrt-call{position:fixed;z-index:100001;width:310px;max-width:calc(100vw - 28px);background:#12180F;
    border:1px solid #2A362E;border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.6);padding:15px 16px;
    transition:top .2s ease,left .2s ease;font-family:inherit;color:#F1F5F2}
  .bzrt-call .s{font-size:11px;font-weight:700;letter-spacing:.5px;color:#1FBF63;text-transform:uppercase}
  .bzrt-call h3{margin:6px 0;font-size:16.5px;line-height:1.25;text-wrap:balance}
  .bzrt-call p{margin:0;color:#9AA6A0;font-size:13.5px;line-height:1.5}
  .bzrt-foot{display:flex;align-items:center;gap:8px;margin-top:14px}
  .bzrt-dots{display:flex;gap:5px;flex:1;flex-wrap:wrap}
  .bzrt-dots i{width:6px;height:6px;border-radius:50%;background:#2A362E;transition:.15s}
  .bzrt-dots i.on{background:#1FBF63;width:15px;border-radius:3px}
  .bzrt-b{border:1px solid #2A362E;background:#1A2318;color:#F1F5F2;border-radius:8px;padding:7px 13px;
    font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit}
  .bzrt-b.p{background:linear-gradient(135deg,#1FBF63,#4EDB8D);color:#04140B;border-color:transparent}
  .bzrt-b:focus-visible,.bzrt-fab:focus-visible,.bzrt-skip:focus-visible{outline:2px solid #4EDB8D;outline-offset:2px}
  .bzrt-wel{position:fixed;inset:0;z-index:100002;display:grid;place-items:center;
    background:rgba(3,6,4,.72);padding:16px}
  .bzrt-wc{width:min(94%,420px);background:#12180F;border:1px solid #2A362E;border-radius:18px;
    box-shadow:0 20px 60px rgba(0,0,0,.6);padding:26px 24px;text-align:center;font-family:inherit;color:#F1F5F2}
  .bzrt-wc .em{font-size:34px}
  .bzrt-wc h2{margin:8px 0 6px;font-size:22px;text-wrap:balance}
  .bzrt-wc p{margin:0 auto;color:#9AA6A0;font-size:14px;line-height:1.55;max-width:36ch}
  .bzrt-wc .bs{display:flex;gap:10px;justify-content:center;margin-top:20px;flex-wrap:wrap}
  .bzrt-big{border:none;cursor:pointer;border-radius:11px;padding:12px 20px;font-weight:800;font-size:14px;font-family:inherit}
  .bzrt-big.p{background:linear-gradient(135deg,#1FBF63,#4EDB8D);color:#04140B}
  .bzrt-big.g{background:#1A2318;color:#F1F5F2;border:1px solid #2A362E}
  @media (prefers-reduced-motion:reduce){.bzrt-call{transition:none}}
  @media (max-width:520px){.bzrt-call{width:calc(100vw - 24px)}}
  `;

  let opts, i = 0, active = false, els = {};
  const seenKey = () => 'bzr_tour_seen_' + opts.id;
  const seen = () => { try { return localStorage.getItem(seenKey()) === '1'; } catch { return false; } };
  const markSeen = () => { try { localStorage.setItem(seenKey(), '1'); } catch {} };

  function injectCss() {
    if (document.getElementById('bzrt-css')) return;
    const s = document.createElement('style'); s.id = 'bzrt-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function build() {
    // Botão flutuante
    const fab = document.createElement('button');
    fab.className = 'bzrt-fab ' + (opts.fabPos === 'bottom-right' ? 'right' : 'left');
    fab.type = 'button'; fab.setAttribute('aria-label', 'Tour guiado');
    fab.textContent = opts.button || '🎓 Tour';
    fab.onclick = () => (active ? stop() : start(0));
    document.body.appendChild(fab);

    // Overlay (spotlight + balão)
    const ov = document.createElement('div'); ov.className = 'bzrt-ov';
    ov.innerHTML = `
      <svg class="bzrt-svg" id="bzrt-svg">
        <defs><mask id="bzrt-hole">
          <rect x="0" y="0" width="100%" height="100%" fill="#fff"/>
          <rect id="bzrt-holeR" x="0" y="0" width="0" height="0" rx="12" fill="#000"/>
        </mask></defs>
        <rect class="dim" x="0" y="0" width="100%" height="100%" mask="url(#bzrt-hole)"/>
      </svg>
      <button class="bzrt-skip" type="button" id="bzrt-skip">Sair do tour ✕</button>
      <div class="bzrt-call" id="bzrt-call" role="dialog" aria-live="polite">
        <div class="s" id="bzrt-s"></div>
        <h3 id="bzrt-t"></h3>
        <p id="bzrt-p"></p>
        <div class="bzrt-foot">
          <div class="bzrt-dots" id="bzrt-dots"></div>
          <button class="bzrt-b" type="button" id="bzrt-prev">Voltar</button>
          <button class="bzrt-b p" type="button" id="bzrt-next">Próximo</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    els = {
      fab, ov, svg: ov.querySelector('#bzrt-svg'), hole: ov.querySelector('#bzrt-holeR'),
      call: ov.querySelector('#bzrt-call'), s: ov.querySelector('#bzrt-s'), t: ov.querySelector('#bzrt-t'),
      p: ov.querySelector('#bzrt-p'), dots: ov.querySelector('#bzrt-dots'),
      prev: ov.querySelector('#bzrt-prev'), next: ov.querySelector('#bzrt-next'), skip: ov.querySelector('#bzrt-skip'),
    };
    opts.steps.forEach(() => els.dots.appendChild(document.createElement('i')));
    els.next.onclick = () => (i < opts.steps.length - 1 ? (i++, place()) : stop());
    els.prev.onclick = () => (i > 0 && (i--, place()));
    els.skip.onclick = stop;
    window.addEventListener('resize', () => active && place());
    window.addEventListener('keydown', (e) => {
      if (!active) return;
      if (e.key === 'Escape') stop();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') els.next.click();
      else if (e.key === 'ArrowLeft') els.prev.click();
    });
  }

  function welcome() {
    const w = document.createElement('div'); w.className = 'bzrt-wel';
    w.innerHTML = `<div class="bzrt-wc"><div class="em">${opts.emoji || '👋'}</div>
      <h2>${opts.title || 'Bem-vindo ao BzR'}</h2>
      <p>${opts.intro || 'Quer um tour rápido mostrando o que dá pra fazer aqui?'}</p>
      <div class="bs"><button class="bzrt-big g" type="button" id="bzrt-no">Agora não</button>
        <button class="bzrt-big p" type="button" id="bzrt-yes">Fazer o tour</button></div></div>`;
    document.body.appendChild(w);
    w.querySelector('#bzrt-no').onclick = () => { w.remove(); markSeen(); };
    w.querySelector('#bzrt-yes').onclick = () => { w.remove(); markSeen(); start(0); };
  }

  function rectOf(sel) {
    if (!sel) return null;
    const el = document.querySelector(sel);
    if (!el) return null;
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch {}
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return null; // fora da tela
    return r;
  }

  function place() {
    const st = opts.steps[i];
    els.s.textContent = 'Passo ' + (i + 1) + ' de ' + opts.steps.length;
    els.t.textContent = st.title; els.p.textContent = st.text;
    [...els.dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    els.prev.style.visibility = i ? 'visible' : 'hidden';
    els.next.textContent = i === opts.steps.length - 1 ? 'Concluir' : 'Próximo';
    // svg cobre a viewport
    els.svg.setAttribute('width', innerWidth); els.svg.setAttribute('height', innerHeight);

    const r = rectOf(st.sel);
    const cw = els.call.offsetWidth || 310, ch = els.call.offsetHeight || 190;
    if (!r) { // centralizado, sem foco
      els.hole.setAttribute('width', 0); els.hole.setAttribute('height', 0);
      els.call.style.left = Math.max(12, (innerWidth - cw) / 2) + 'px';
      els.call.style.top = Math.max(12, (innerHeight - ch) / 2) + 'px';
      return;
    }
    const pad = 8;
    els.hole.setAttribute('x', Math.max(2, r.left - pad)); els.hole.setAttribute('y', Math.max(2, r.top - pad));
    els.hole.setAttribute('width', r.width + pad * 2); els.hole.setAttribute('height', r.height + pad * 2);
    let left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), innerWidth - cw - 12);
    let top = r.bottom + 14;
    if (top + ch > innerHeight - 12) top = r.top - ch - 14;
    if (top < 12) top = 12;
    els.call.style.left = left + 'px'; els.call.style.top = top + 'px';
  }

  function start(n) { active = true; i = n || 0; els.ov.classList.add('show'); els.fab.classList.add('on'); els.fab.textContent = '✕ Sair do tour'; place(); }
  function stop() { active = false; els.ov.classList.remove('show'); els.fab.classList.remove('on'); els.fab.textContent = opts.button || '🎓 Tour'; markSeen(); }

  window.BzrTour = {
    init(config) {
      opts = Object.assign({ id: 'geral', fabPos: 'bottom-left', button: '🎓 Tour', steps: [] }, config);
      if (!Array.isArray(opts.steps) || !opts.steps.length) return;
      const run = () => {
        injectCss(); build();
        if (opts.autostart !== false && !seen()) setTimeout(welcome, 600);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
      else run();
    },
    start: () => start(0),
  };
})();
