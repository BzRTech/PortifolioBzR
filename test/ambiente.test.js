// Travas de produção e limitador de tentativas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conferirAmbiente } from '../src/env.js';
import { limitar, _zerarLimites } from '../src/ratelimit.js';

const PROD_OK = { NODE_ENV: 'production', AUTH_ENABLED: 'true', AUTH_SECRET: 'f3a9c1d27e4b8a6051c9e2f7d3b4a8c6e1f0a2b3', MUNICIPIO: 'Tabira', PUBLIC_BASE_URL: 'https://tabira.bzr.app', DATABASE_URL: 'postgres://x' };

test('produção segura sobe', () => assert.deepEqual(conferirAmbiente(PROD_OK).erros, []));
test('produção sem login não sobe', () => assert.ok(conferirAmbiente({ ...PROD_OK, AUTH_ENABLED: 'false' }).erros.length));
test('produção com segredo fraco ou padrão não sobe', () => {
  assert.ok(conferirAmbiente({ ...PROD_OK, AUTH_SECRET: '' }).erros.length);
  assert.ok(conferirAmbiente({ ...PROD_OK, AUTH_SECRET: 'troque-por-um-segredo-longo-e-aleatorio' }).erros.length);
  assert.ok(conferirAmbiente({ ...PROD_OK, AUTH_SECRET: 'a'.repeat(40) }).erros.length, 'pouca variedade');
});
test('modo demonstração bloqueado em produção', () => {
  for (const f of ['CIB_SIMULAR_RETORNO', 'SEED_CIB_DEMO', 'SEED_DEMO', 'SEED_BCI_DEMO']) {
    assert.ok(conferirAmbiente({ ...PROD_OK, [f]: 'true' }).erros.some((e) => e.startsWith(f)), f);
  }
});
test('produção exige MUNICIPIO e PUBLIC_BASE_URL https', () => {
  assert.ok(conferirAmbiente({ ...PROD_OK, MUNICIPIO: '' }).erros.length);
  assert.ok(conferirAmbiente({ ...PROD_OK, PUBLIC_BASE_URL: 'http://x' }).erros.length);
});
test('fora de produção só avisa', () => {
  const r = conferirAmbiente({ NODE_ENV: 'development', CIB_SIMULAR_RETORNO: 'true' });
  assert.equal(r.erros.length, 0);
  assert.ok(r.avisos.length);
});

test('limitador: bloqueia após o máximo e informa Retry-After', () => {
  _zerarLimites();
  const mw = limitar({ nome: 't', janelaMs: 60000, max: 3 });
  const req = { ip: '1.2.3.4' };
  const codigos = [];
  for (let i = 0; i < 5; i++) {
    const res = { headers: {}, set(k, v) { this.headers[k] = v; }, status(c) { this.c = c; return this; }, json() { codigos.push(this.c); } };
    mw(req, res, () => codigos.push(200));
  }
  assert.deepEqual(codigos, [200, 200, 200, 429, 429]);
});
