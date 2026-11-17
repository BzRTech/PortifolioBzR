// Página inicial de cada prefeitura (raiz da instância).
//
// Com um deploy por prefeitura (ADR 0001), o endereço da instância é o que o
// munícipe recebe no carnê, no QR dos documentos e no WhatsApp da prefeitura:
// ele precisa abrir a página DA PREFEITURA (nome, brasão, cor, serviços e
// atendimento), não a apresentação comercial da BzR.
//   LANDING=prefeitura | bzr  (padrão: prefeitura quando MUNICIPIO está definido)
// A página é gerada no servidor (busca, prévia em WhatsApp/redes, sem "piscar").
// Os textos vêm da aba "Município" do CIB; tudo é escapado.
import { Router } from 'express';
import { getConfig } from './cib.js';
import { MUNICIPIO_FIXO, modulosAtivos, origemDe } from './env.js';
import { muniDe } from './util.js';
import { query, isConfigured } from './db.js';
import { municipioPortal } from './cidadao.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linhas = (s) => esc(s).replace(/\r?\n/g, '<br>');
const COR_PADRAO = '#0f5132';

/** Cor de texto legível sobre a cor da prefeitura (contraste WCAG). */
export function corTexto(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05) / (L + 0.05) >= (L + 0.05) / 0.05 ? '#ffffff' : '#111111';
}
const brasaoSeguro = (b) => (/^(data:image\/(png|jpeg|svg\+xml);base64,|https:\/\/)/.test(String(b || '')) ? b : '');
const soDigitos = (v) => String(v || '').replace(/\D/g, '');

export function usarPaginaPrefeitura(env = process.env) {
  const l = String(env.LANDING || '').toLowerCase();
  if (l === 'prefeitura') return true;
  if (l === 'bzr') return false;
  return Boolean(String(env.MUNICIPIO || '').trim());
}

export function renderPaginaPrefeitura(cfg, { modulos = [], origem = '', stats = null } = {}) {
  const cor = /^#[0-9a-f]{6}$/i.test(cfg.corPrimaria) ? cfg.corPrimaria : COR_PADRAO;
  const tinta = corTexto(cor);
  const brasao = brasaoSeguro(cfg.brasao);
  const nome = cfg.nomeOficial || `Prefeitura Municipal de ${cfg.municipio}`;
  const cidade = cfg.municipio || nome.replace(/^Prefeitura (Municipal )?de /i, '');
  const portal = modulos.includes('portal');
  const docs = modulos.includes('documentos');
  const msg = cfg.mensagemInicial || `Consulte os seus imóveis, emita certidões e declarações e faça solicitações ao cadastro imobiliário de ${cidade}, sem sair de casa.`;
  const wa = soDigitos(cfg.whatsapp);
  const waLink = wa ? `https://wa.me/${wa.length <= 11 ? '55' + wa : wa}` : '';
  const descricao = `${nome} — cadastro imobiliário on-line: seus imóveis, certidões, declarações e solicitações.`;
  const servicos = [
    portal && ['🏠', 'Meus imóveis', 'Veja os imóveis cadastrados no seu CPF ou CNPJ: inscrição, CIB, áreas e valor venal.', '/cidadao', 'Entrar'],
    portal && ['📄', 'Certidões e declarações', 'Dados cadastrais, valor venal, numeração predial, situação cadastral e CIB — na hora, com QR de validação.', '/cidadao', 'Emitir'],
    portal && ['📥', 'Solicitações', 'Atualização cadastral, transferência (ITBI), desmembramento, vistoria e outros pedidos, com protocolo.', '/cidadao', 'Solicitar'],
    docs && ['✅', 'Validar documento', 'Confira se uma certidão ou declaração da prefeitura é autêntica pelo código ou pelo QR.', '/validar', 'Validar'],
    docs && ['🔎', 'Consultar protocolo', 'Acompanhe um pedido pelo número do protocolo e o CPF/CNPJ de quem pediu.', '/validar#protocolo', 'Consultar'],
  ].filter(Boolean);
  const faq = [
    ['Preciso ir à prefeitura?', portal ? 'Para a maior parte dos serviços, não. Certidões e declarações saem na hora pelo portal, e os pedidos são feitos com envio de documentos pela internet. Se a prefeitura precisar de algo, você é avisado no protocolo.' : 'Procure o atendimento do cadastro imobiliário nos contatos abaixo.'],
    ['Como entro no portal?', 'Com o seu CPF ou CNPJ e uma confirmação de que é você: a conta gov.br, um código enviado ao e-mail do cadastro ou a inscrição de um dos seus imóveis (está no carnê do IPTU). Só o CPF não basta — é para proteger os seus dados.'],
    ['O que é o CIB?', 'O Cadastro Imobiliário Brasileiro é um código nacional, atribuído pela Receita Federal pelo Sinter, que identifica cada imóvel. O município envia os dados do cadastro e o código aparece no portal e nos documentos.'],
    ['Meu imóvel não aparece. E agora?', 'O portal mostra os imóveis em que você consta como contribuinte. Se comprou recentemente ou o imóvel ainda está no nome de outra pessoa, faça uma solicitação de transferência ou de inclusão, com a escritura ou o contrato.'],
    ['Como sei se um documento é verdadeiro?', 'Todo documento tem número, código de validação e QR. Em "Validar documento" você vê se ele é autêntico, se está válido e se foi cancelado.'],
  ];
  const ld = { '@context': 'https://schema.org', '@type': 'GovernmentOrganization', name: nome, url: origem || undefined,
    telephone: cfg.telefone || undefined, email: cfg.email || undefined, address: cfg.endereco ? { '@type': 'PostalAddress', streetAddress: cfg.endereco, addressLocality: cidade, addressRegion: cfg.uf, addressCountry: 'BR' } : undefined };

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(nome)} — Cadastro imobiliário on-line</title>
<meta name="description" content="${esc(descricao)}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(nome)}" />
<meta property="og:description" content="${esc(descricao)}" />
${origem ? `<meta property="og:url" content="${esc(origem)}/" /><link rel="canonical" href="${esc(origem)}/" />` : ''}
<meta name="theme-color" content="${esc(cor)}" />
<link rel="icon" href="${brasao ? esc(brasao) : '/assets/marca/favicon.svg'}" />
<script>try{var _t=localStorage.getItem('bzr-theme');if(_t)document.documentElement.setAttribute('data-theme',_t)}catch(e){}</script>
<link rel="stylesheet" href="/styles.css" />
<link rel="stylesheet" href="/prefeitura.css" />
<style>:root{--pref:${esc(cor)};--pref-ink:${tinta}}</style>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
</head>
<body class="pref">
<a class="pular" href="#servicos">Pular para os serviços</a>
<header class="pref-topo">
  <div class="in">
    <a class="marca" href="/">${brasao ? `<img src="${esc(brasao)}" alt="Brasão de ${esc(cidade)}" />` : `<span class="sem-brasao" aria-hidden="true">${esc(cidade.slice(0, 1))}</span>`}
      <span><strong>${esc(nome)}</strong><small>${esc([cfg.secretaria, cfg.setor].filter(Boolean).join(' · '))}</small></span></a>
    <nav aria-label="Atalhos">${portal ? '<a href="/cidadao" class="dest">Portal do Cidadão</a>' : ''}${docs ? '<a href="/validar">Validar documento</a>' : ''}<a href="#atendimento">Atendimento</a>
      <button class="tema" data-theme-toggle onclick="BzrTheme.toggle()" aria-label="Alternar tema">🌙</button></nav>
  </div>
</header>
${cfg.aviso ? `<div class="aviso" role="status"><div class="in"><b>Aviso</b><span>${linhas(cfg.aviso)}</span></div></div>` : ''}
<main>
  <section class="hero"><div class="in">
    <div class="kick">Cadastro imobiliário · ${esc(cidade)}${cfg.uf ? '/' + esc(cfg.uf) : ''}</div>
    <h1>Seu imóvel em ${esc(cidade)}, <em>on-line</em>.</h1>
    <p>${linhas(msg)}</p>
    <div class="acoes">${portal ? '<a class="btn-pref" href="/cidadao">Entrar no Portal do Cidadão</a>' : ''}${docs ? '<a class="btn-sec" href="/validar">Validar um documento</a>' : ''}</div>
    ${portal ? '<p class="mini">Entre com <b>gov.br</b>, com um código no e-mail do cadastro ou com a inscrição do carnê do IPTU.</p>' : ''}
    ${stats ? `<dl class="numeros"><div><dt>imóveis no cadastro</dt><dd>${stats.imoveis.toLocaleString('pt-BR')}</dd></div>${stats.cib ? `<div><dt>com CIB</dt><dd>${stats.cib.toLocaleString('pt-BR')}</dd></div>` : ''}<div><dt>documentos emitidos</dt><dd>${stats.documentos.toLocaleString('pt-BR')}</dd></div></dl>` : ''}
  </div></section>

  <section id="servicos" class="servicos"><div class="in">
    <h2>Serviços</h2>
    <div class="grade">${servicos.map(([ico, t, d, href, cta]) => `<a class="servico" href="${href}"><span class="ico" aria-hidden="true">${ico}</span><h3>${t}</h3><p>${d}</p><span class="cta">${cta} →</span></a>`).join('')}</div>
  </div></section>

  ${portal ? `<section class="passos"><div class="in"><h2>Como funciona</h2><ol>
    <li><b>Entre</b> com o seu CPF/CNPJ e confirme que é você (gov.br, código por e-mail ou inscrição do carnê).</li>
    <li><b>Veja</b> os imóveis no seu nome, com inscrição, CIB, áreas e valor venal.</li>
    <li><b>Emita</b> certidões na hora ou <b>faça um pedido</b> com documentos anexos — e acompanhe pelo protocolo.</li></ol></div></section>` : ''}

  <section class="duvidas"><div class="in"><h2>Dúvidas frequentes</h2>
    ${faq.map(([q, r]) => `<details><summary>${esc(q)}</summary><p>${esc(r)}</p></details>`).join('')}</div></section>

  <section id="atendimento" class="atendimento"><div class="in"><h2>Atendimento presencial e contato</h2>
    <div class="contatos">
      ${cfg.endereco ? `<div><span>Endereço</span><b>${esc(cfg.endereco)}</b></div>` : ''}
      ${cfg.horarioAtendimento ? `<div><span>Horário</span><b>${linhas(cfg.horarioAtendimento)}</b></div>` : ''}
      ${cfg.telefone ? `<div><span>Telefone</span><b><a href="tel:${esc(soDigitos(cfg.telefone))}">${esc(cfg.telefone)}</a></b></div>` : ''}
      ${waLink ? `<div><span>WhatsApp</span><b><a href="${esc(waLink)}" target="_blank" rel="noopener">${esc(cfg.whatsapp)}</a></b></div>` : ''}
      ${cfg.email ? `<div><span>E-mail</span><b><a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a></b></div>` : ''}
      ${/^https?:\/\//.test(cfg.site) ? `<div><span>Site oficial</span><b><a href="${esc(cfg.site)}" target="_blank" rel="noopener">${esc(cfg.site.replace(/^https?:\/\//, ''))}</a></b></div>` : ''}
    </div></div></section>
</main>
<footer class="pref-rodape"><div class="in">
  <div><b>${esc(nome)}</b>${cfg.cnpj ? ` · CNPJ ${esc(cfg.cnpj)}` : ''}<br>${esc([cfg.secretaria, cfg.setor].filter(Boolean).join(' · '))}</div>
  <div class="dir"><a href="/login">Área da equipe</a> · Seus dados são tratados conforme a LGPD (Lei 13.709/2018).<br><span class="dim">Plataforma <a href="/bzr">BzR Gestão Pública</a></span></div>
</div></footer>
<script src="/js/theme.js"></script>
</body>
</html>`;
}

async function estatisticas(municipio) {
  try {
    const r = (await query(`SELECT (SELECT count(*) FROM imoveis WHERE municipio = $1 AND situacao = 'ativo')::int AS imoveis,
      (SELECT count(*) FROM imoveis WHERE municipio = $1 AND situacao = 'ativo' AND cib <> '' AND NOT cib_simulado)::int AS cib,
      (SELECT count(*) FROM documentos WHERE municipio = $1 AND status = 'valido')::int AS documentos`, [municipio])).rows[0];
    return r.imoveis ? r : null;
  } catch { return null; }
}

export const prefeituraRouter = Router();
async function enviarPagina(req, res) {
  if (!isConfigured) return res.status(503).send('Banco não configurado.');
  const municipio = await municipioPortal(req) || (await query('SELECT municipio FROM municipio_config ORDER BY updated_at DESC LIMIT 1')).rows[0]?.municipio || '';
  const cfg = await getConfig(municipio);
  const mostrarNumeros = String(process.env.PAGINA_NUMEROS || 'true') !== 'false';
  res.set('Cache-Control', 'public, max-age=60');
  res.type('html').send(renderPaginaPrefeitura(cfg, {
    modulos: modulosAtivos(), origem: origemDe(process.env.PUBLIC_BASE_URL) || `${req.protocol}://${req.get('host')}`,
    stats: mostrarNumeros ? await estatisticas(municipio) : null,
  }));
}
// "/" é a página da prefeitura nas instâncias de prefeitura; "/inicio" sempre (prévia na demonstração: /inicio?municipio=…).
prefeituraRouter.get('/', (req, res, next) => (usarPaginaPrefeitura() ? enviarPagina(req, res).catch(next) : next()));
prefeituraRouter.get('/inicio', (req, res, next) => enviarPagina(req, res).catch(next));
