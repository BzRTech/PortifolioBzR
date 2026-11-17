// Página inicial de cada prefeitura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPaginaPrefeitura, corTexto, usarPaginaPrefeitura } from '../src/prefeitura.js';

const base = { municipio: 'Tabira', nomeOficial: 'Prefeitura Municipal de Tabira', uf: 'PE', secretaria: 'Sec. de Finanças', setor: 'Cadastro', endereco: 'Rua A, 1',
  telefone: '(87) 3800-0000', email: 'cadastro@tabira.invalid', site: 'https://tabira.invalid', brasao: '', corPrimaria: '#1d4e89', horarioAtendimento: '8h às 13h',
  whatsapp: '(87) 99999-0000', mensagemInicial: '', aviso: '', cnpj: '' };

test('qual página abre na raiz', () => {
  assert.equal(usarPaginaPrefeitura({ MUNICIPIO: 'Tabira' }), true);
  assert.equal(usarPaginaPrefeitura({}), false, 'deploy da BzR / demonstração');
  assert.equal(usarPaginaPrefeitura({ MUNICIPIO: 'Tabira', LANDING: 'bzr' }), false);
  assert.equal(usarPaginaPrefeitura({ LANDING: 'prefeitura' }), true);
});

test('cor do texto com contraste sobre a cor da prefeitura', () => {
  assert.equal(corTexto('#1d4e89'), '#ffffff');
  assert.equal(corTexto('#f5c518'), '#111111');
  assert.equal(corTexto('xyz'), '#ffffff');
});

test('textos da prefeitura são escapados (sem injeção de HTML)', () => {
  const h = renderPaginaPrefeitura({ ...base, aviso: '<script>alert(1)</script>', mensagemInicial: '<img src=x onerror=alert(1)>', nomeOficial: 'Pref "X" <b>', corPrimaria: 'red;}</style><script>' }, { modulos: ['portal', 'documentos'] });
  assert.ok(!h.includes('<script>alert(1)'), 'aviso escapado');
  assert.ok(!h.includes('<img src=x'), 'mensagem escapada');
  assert.ok(!h.includes('</style><script>'), 'cor inválida ignorada');
  assert.ok(h.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(h.includes('--pref:#0f5132'), 'cor padrão quando inválida');
});

test('brasão só data:image ou https; serviços seguem os módulos ativos', () => {
  const h1 = renderPaginaPrefeitura({ ...base, brasao: 'javascript:alert(1)' }, { modulos: ['documentos'] });
  assert.ok(!h1.includes('javascript:'));
  assert.ok(!h1.includes('href="/cidadao"'), 'sem portal quando o módulo está desligado');
  assert.ok(h1.includes('href="/validar"'));
  const h2 = renderPaginaPrefeitura(base, { modulos: ['portal', 'documentos'], origem: 'https://tabira.bzr.app' });
  assert.ok(h2.includes('href="/cidadao"'));
  assert.ok(h2.includes('https://wa.me/5587999990000'));
  assert.ok(h2.includes('<link rel="canonical" href="https://tabira.bzr.app/"'));
  assert.ok(h2.includes('"@type":"GovernmentOrganization"'));
});
