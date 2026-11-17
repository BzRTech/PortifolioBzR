// Troca de município (ticket SSO) e chaves da API externa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitirTicket, verificarTicket, TICKET_TTL_S } from '../src/sso.js';
import { gerarChave, lerChave } from '../src/api-externa.js';
import { lerInstancias, conferirAmbiente } from '../src/env.js';

const S = 'sso-compartilhado-9f8e7d6c5b4a3210fedcba';
const dados = { email: 'Tecnico@BzR.com', nome: 'Técnico', iss: 'https://patos.bzr.app', issMunicipio: 'Patos', aud: 'https://sousa.bzr.app' };

test('ticket SSO: válido só no destino, só com o segredo certo e só dentro do prazo', () => {
  const t = emitirTicket(S, dados);
  const ok = verificarTicket(S, t, { aud: 'https://sousa.bzr.app' });
  assert.equal(ok.ok, true);
  assert.equal(ok.dados.email, 'tecnico@bzr.com', 'e-mail normalizado');
  assert.match(ok.dados.jti, /^[0-9a-f]{32}$/);
  assert.equal(verificarTicket(S, t, { aud: 'https://patos.bzr.app' }).ok, false, 'outra instância');
  assert.equal(verificarTicket('outro-segredo-0123456789abcdefghijkl', t, { aud: 'https://sousa.bzr.app' }).ok, false, 'segredo errado');
  assert.equal(verificarTicket(S, t, { aud: 'https://sousa.bzr.app' }, Date.now() + (TICKET_TTL_S + 1) * 1000).ok, false, 'expirado');
  assert.equal(verificarTicket('', t, { aud: 'https://sousa.bzr.app' }).ok, false, 'SSO desligado');
});

test('ticket SSO adulterado é recusado', () => {
  const [p, sig] = emitirTicket(S, dados).split('.');
  const outro = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), email: 'admin@bzr.com' })).toString('base64url');
  assert.equal(verificarTicket(S, `${outro}.${sig}`, { aud: 'https://sousa.bzr.app' }).ok, false);
  assert.equal(verificarTicket(S, 'lixo', { aud: 'https://sousa.bzr.app' }).ok, false);
});

test('chave de API: formato, prefixo público e hash', () => {
  const g = gerarChave();
  assert.match(g.chave, /^bzr_[0-9a-f]{10}_[A-Za-z0-9_-]{43}$/);
  assert.equal(lerChave(g.chave).prefixo, g.prefixo);
  assert.match(g.hash, /^[0-9a-f]{64}$/);
  assert.equal(lerChave('bzr_123_abc'), null);
  assert.equal(lerChave(''), null);
  assert.notEqual(gerarChave().chave, g.chave);
});

test('INSTANCIAS: lê lista, ignora a própria instância e aponta inválidas', () => {
  const r = lerInstancias({ INSTANCIAS: 'Sousa=https://sousa.bzr.app; Patos=https://patos.bzr.app/; quebrado', PUBLIC_BASE_URL: 'https://patos.bzr.app' });
  assert.deepEqual(r.lista, [{ municipio: 'Sousa', url: 'https://sousa.bzr.app' }]);
  assert.deepEqual(r.invalidas, ['quebrado']);
  const j = lerInstancias({ INSTANCIAS: '[{"municipio":"Sousa","url":"https://sousa.bzr.app"}]' });
  assert.equal(j.lista.length, 1);
});

test('produção: INSTANCIAS só https e SSO_SECRET forte e diferente do AUTH_SECRET', () => {
  const PROD = { NODE_ENV: 'production', AUTH_ENABLED: 'true', AUTH_SECRET: 'f3a9c1d27e4b8a6051c9e2f7d3b4a8c6e1f0a2b3', MUNICIPIO: 'Patos', PUBLIC_BASE_URL: 'https://patos.bzr.app', DATABASE_URL: 'postgres://x' };
  assert.deepEqual(conferirAmbiente({ ...PROD, INSTANCIAS: 'Sousa=https://sousa.bzr.app', SSO_SECRET: S }).erros, []);
  assert.ok(conferirAmbiente({ ...PROD, INSTANCIAS: 'Sousa=http://sousa.bzr.app' }).erros.length, 'http');
  assert.ok(conferirAmbiente({ ...PROD, SSO_SECRET: 'curto' }).erros.length, 'fraco');
  assert.ok(conferirAmbiente({ ...PROD, SSO_SECRET: PROD.AUTH_SECRET }).erros.length, 'igual ao AUTH_SECRET');
});
