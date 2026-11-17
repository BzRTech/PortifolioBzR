// Portal do Cidadão: sessão própria, anexos, entradas habilitadas e id_token do gov.br.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { emitirSessao, lerSessao, metodosAtivos, verificarIdToken, SESSAO_MIN } from '../src/cidadao.js';
import { verificarToken } from '../src/auth.js';
import { validarAnexos, tipoPorAssinatura } from '../src/anexos.js';
import { mascararEmail } from '../src/email.js';

test('sessão do cidadão: assinada, expira e NÃO vale como login da equipe', () => {
  const t = emitirSessao({ doc: '529.982.247-25', nome: 'Maria', metodo: 'govbr', municipio: 'X' });
  const s = lerSessao(t);
  assert.equal(s.doc, '52998224725');
  assert.equal(s.typ, 'cidadao');
  assert.equal(verificarToken(t), null, 'chave diferente da equipe');
  assert.equal(lerSessao(t, Date.now() + (SESSAO_MIN * 60 + 5) * 1000), null, 'expirada');
  const [p, sig] = t.split('.');
  const outro = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), doc: '11144477735' })).toString('base64url');
  assert.equal(lerSessao(`${outro}.${sig}`), null, 'adulterada');
});

test('anexos: tipo pelo conteúdo, não pela extensão; limite de tamanho e quantidade', () => {
  assert.equal(tipoPorAssinatura(Buffer.from('%PDF-1.7')), 'application/pdf');
  assert.equal(tipoPorAssinatura(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(tipoPorAssinatura(Buffer.from('MZ\x90\x00')), null);
  const ok = validarAnexos([{ nome: '../../escritura.pdf', base64: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 x').toString('base64') }]);
  assert.equal(ok[0].tipo, 'application/pdf');
  assert.ok(!ok[0].nome.includes('/'), 'nome sem caminho');
  assert.throws(() => validarAnexos([{ nome: 'virus.pdf', base64: Buffer.from('MZ\x90').toString('base64') }]), /não é PDF/);
  assert.throws(() => validarAnexos([{ nome: 'grande.pdf', base64: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64') }]), /5 MB/);
  assert.throws(() => validarAnexos(Array.from({ length: 6 }, () => ({ nome: 'a.pdf', base64: Buffer.from('%PDF-').toString('base64') }))), /no máximo 5/);
});

test('entradas do portal: gov.br só com credenciais; e-mail em produção só com SMTP', () => {
  assert.deepEqual(metodosAtivos({ NODE_ENV: 'production' }), ['inscricao']);
  assert.deepEqual(metodosAtivos({ NODE_ENV: 'production', SMTP_URL: 'smtp://x', GOVBR_CLIENT_ID: 'a', GOVBR_CLIENT_SECRET: 'b' }), ['govbr', 'email', 'inscricao']);
  assert.deepEqual(metodosAtivos({ NODE_ENV: 'production', PORTAL_ENTRADA: 'govbr', GOVBR_CLIENT_ID: 'a', GOVBR_CLIENT_SECRET: 'b' }), ['govbr']);
  assert.deepEqual(metodosAtivos({ NODE_ENV: 'development' }), ['email', 'inscricao'], 'demonstração: código na tela');
});

test('gov.br: id_token RS256 conferido (assinatura, emissor, audiência, nonce, CPF)', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' };
  const g = { base: 'https://sso.staging.acesso.gov.br', clientId: 'cli' };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const assinar = (claims, chave = privateKey) => { const h = b64({ alg: 'RS256', kid: 'k1' }); const p = b64(claims); return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), chave).toString('base64url')}`; };
  const base = { iss: g.base + '/', aud: 'cli', sub: '52998224725', name: 'Maria', nonce: 'n1', exp: Math.floor(Date.now() / 1000) + 300 };
  const r = await verificarIdToken(assinar(base), { g, nonce: 'n1', chaves: [jwk] });
  assert.equal(r.cpf, '52998224725');
  await assert.rejects(verificarIdToken(assinar(base), { g, nonce: 'outro', chaves: [jwk] }), /nonce/);
  await assert.rejects(verificarIdToken(assinar({ ...base, aud: 'x' }), { g, nonce: 'n1', chaves: [jwk] }), /audiência/);
  await assert.rejects(verificarIdToken(assinar({ ...base, iss: 'https://falso' }), { g, nonce: 'n1', chaves: [jwk] }), /emissor/);
  await assert.rejects(verificarIdToken(assinar({ ...base, exp: 10 }), { g, nonce: 'n1', chaves: [jwk] }), /expirado/);
  const outraChave = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(verificarIdToken(assinar(base, outraChave), { g, nonce: 'n1', chaves: [jwk] }), /assinatura/);
});

test('e-mail mascarado para o cidadão', () => assert.equal(mascararEmail('maria.exemplo@gmail.com'), 'm***@g***.com'));
