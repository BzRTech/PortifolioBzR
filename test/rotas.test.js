// Regressão: login aplicado a TODAS as rotas por um router (ex.: bciRouter.use(requireAuth))
// bloqueava as APIs do Território e das O.S. e as páginas públicas. Todo middleware de
// autenticação em router precisa de prefixo do próprio módulo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const SRC = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src');

test('nenhum router aplica autenticação sem prefixo', () => {
  const problemas = [];
  for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.js'))) {
    const linhas = fs.readFileSync(path.join(SRC, f), 'utf8').split('\n');
    linhas.forEach((l, i) => {
      // xxxRouter.use(requireAuth…) / .use(requireRole(…)) sem caminho como 1º argumento
      if (/\w+Router\.use\(\s*(requireAuth|requireRole|exigir\w*|autenticar\w*)\b/.test(l)) problemas.push(`${f}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepEqual(problemas, [], 'use router.use("/api/<modulo>", requireAuth)');
});

test('server.js não aplica requireAuth global', () => {
  const s = fs.readFileSync(path.join(SRC, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(s, /app\.use\(\s*require(Auth|Role)\b/);
});
