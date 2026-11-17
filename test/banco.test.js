// Integração com PostgreSQL/PostGIS. Roda só com TEST_DATABASE_URL (banco
// descartável — as migrations são aplicadas e um município de teste é criado):
//   TEST_DATABASE_URL=postgres://… npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL = process.env.TEST_DATABASE_URL;
const pular = !URL && 'defina TEST_DATABASE_URL para os testes de banco';
let db, M, cib, rem, docs, imp, numer;

before(async () => {
  if (!URL) return;
  process.env.DATABASE_URL = URL;
  process.env.NODE_ENV = 'test';
  db = await import('../src/db.js');
  const { runMigrations } = await import('../src/migrate.js');
  await runMigrations({ log: () => {} });
  cib = await import('../src/cib.js');
  rem = await import('../src/cib-remessas.js');
  docs = await import('../src/documentos.js');
  imp = await import('../src/importacao.js');
  numer = await import('../src/numeradores.js');
  M = `Teste ${Date.now()}`;
  await db.query(`INSERT INTO municipio_config (municipio, nome_oficial, codigo_ibge, responsavel_nome) VALUES ($1, $2, '2500000', 'Resp')`, [M, 'Prefeitura de ' + M]);
  for (let i = 1; i <= 3; i++) {
    await db.query(`INSERT INTO imoveis (municipio, inscricao, tipo, tp_arquitetonico, destinacao, logradouro, tipo_logradouro, numero, bairro, tem_bairro, cep,
        area_terreno_m2, area_construida_m2, contribuinte_nome, contribuinte_doc) VALUES ($1,$2,'predial',1,1,'Rua A',250,$3,'Centro',true,'58700000',300,100,'Fulano','52998224725')`,
      [M, `T.${i}`, String(i)]);
  }
  await cib.processarImoveis(null, { municipio: M });
});
after(async () => { if (db) await db.closePool(); });

test('numeração de documentos sem duplicidade com 40 emissões simultâneas', { skip: pular }, async () => {
  const im = (await db.query(`SELECT id FROM imoveis WHERE municipio = $1 LIMIT 1`, [M])).rows[0];
  const emitidos = await Promise.all(Array.from({ length: 40 }, () => docs.emitirDocumento({ municipio: M, tipo: 'certidao_cadastral', imovelId: im.id, usuario: 't' })));
  const nums = emitidos.map((d) => d.numero);
  assert.equal(new Set(nums).size, 40, 'todos os números distintos');
  const seqs = emitidos.map((d) => d.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, Array.from({ length: 40 }, (_, i) => i + 1), 'sequência contínua, sem buracos');
});

test('numerador: rollback devolve o número', { skip: pular }, async () => {
  const chave = M + '|rb';
  await assert.rejects(db.withTransaction(async (c) => { await numer.proximoNumero(c, 'documento', chave, 2026); throw new Error('falha'); }));
  const n = await db.withTransaction((c) => numer.proximoNumero(c, 'documento', chave, 2026));
  assert.equal(n, 1);
});

test('documento emitido é imutável no banco (trigger) e o hash JCS confere', { skip: pular }, async () => {
  const im = (await db.query(`SELECT id FROM imoveis WHERE municipio = $1 LIMIT 1`, [M])).rows[0];
  const d = await docs.emitirDocumento({ municipio: M, tipo: 'declaracao_situacao', imovelId: im.id, usuario: 't' });
  await assert.rejects(db.query(`UPDATE documentos SET conteudo = '{}'::jsonb WHERE id = $1`, [d.id]), /imutável/);
  await assert.rejects(db.query(`UPDATE documentos SET numero = 'X' WHERE id = $1`, [d.id]), /imutável/);
  await assert.rejects(db.query(`DELETE FROM documentos WHERE id = $1`, [d.id]), /não pode ser excluído/);
  await assert.rejects(db.query(`UPDATE documentos SET status = 'cancelado', motivo_cancelamento = 'x' WHERE id = $1`, [d.id]), /imutável/, 'motivo curto');
  await db.query(`UPDATE documentos SET status = 'cancelado', motivo_cancelamento = 'emitido por engano', cancelado_em = NOW() WHERE id = $1`, [d.id]);
  await assert.rejects(db.query(`UPDATE documentos SET status = 'valido' WHERE id = $1`, [d.id]), /imutável/, 'cancelado não volta');
  const { createHash } = await import('crypto');
  const { jcs } = await import('../src/cib-validacao.js');
  const row = (await db.query('SELECT conteudo, hash_conteudo, hash_alg FROM documentos WHERE id = $1', [d.id])).rows[0];
  assert.equal(row.hash_alg, 'sha256/jcs-rfc8785');
  assert.equal(createHash('sha256').update(jcs(row.conteudo), 'utf8').digest('hex'), row.hash_conteudo);
});

test('auditoria é somente-inserção', { skip: pular }, async () => {
  await cib.auditar(null, { municipio: M, entidade: 't', acao: 't', detalhe: 'x' });
  await assert.rejects(db.query(`UPDATE cib_auditoria SET detalhe = 'y' WHERE municipio = $1`, [M]), /somente-inserção/);
  await assert.rejects(db.query(`DELETE FROM cib_auditoria WHERE municipio = $1`, [M]), /somente-inserção/);
});

test('remessa no leiaute oficial e retorno idempotente', { skip: pular }, async () => {
  await db.query(`INSERT INTO cib_movimentacoes (municipio, imovel_id, inscricao, tipo, origem, status, validado_em, competencia)
    SELECT municipio, id, inscricao, 'inclusao', 'implantacao', 'validada', NOW(), '2026-11' FROM imoveis WHERE municipio = $1`, [M]);
  // um imóvel com erro de leiaute: sai da remessa e volta para a fila
  await db.query(`UPDATE imoveis SET cep = '' WHERE municipio = $1 AND inscricao = 'T.3'`, [M]);
  const { remessa, excluidos } = await rem.prepararRemessa(M, { usuario: 't' });
  assert.equal(remessa.qtd_itens, 2);
  assert.equal(excluidos.length, 1);
  assert.equal((await db.query(`SELECT status FROM cib_movimentacoes WHERE inscricao = 'T.3' AND municipio = $1`, [M])).rows[0].status, 'capturada');
  const arq = (await db.query('SELECT conteudo, sha256 FROM cib_remessa_arquivos WHERE remessa_id = $1', [remessa.id])).rows[0];
  const linhas = arq.conteudo.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(linhas.map((l) => l.operacao), ['I', 'I']);
  await assert.rejects(db.query(`UPDATE cib_remessa_arquivos SET conteudo = '' WHERE remessa_id = $1`, [remessa.id]), /somente-inserção/);
  await rem.enviarRemessa(remessa.id, { modo: 'lote', idArquivo: '2500000_1', usuario: 't' });
  const retorno = { registros: [
    { inscricaoImobiliaria: 'T.1', cib: 'AAAA1111', operacao: 'Inclusão', efetivado: true, falhas: [] },
    { inscricaoImobiliaria: 'T.2', operacao: 'Inclusão', efetivado: false, falhas: [{ codigoFalha: '0004', camposFalha: 'enderecoImovel.tipoLogradouro' }] },
  ] };
  const { parseRetorno } = await import('../src/sinter/retorno.js');
  const r1 = await rem.processarRetorno(remessa.id, parseRetorno(retorno), { origem: 'arquivo' });
  assert.deepEqual([r1.efetivados, r1.rejeitados, r1.repetido], [1, 1, false]);
  const r2 = await rem.processarRetorno(remessa.id, parseRetorno(JSON.stringify(retorno)), { origem: 'arquivo' });
  assert.equal(r2.repetido, true, 'mesmo conteúdo reconhecido');
  // conteúdo diferente mas sobre itens já respondidos: nada muda
  const r3 = await rem.processarRetorno(remessa.id, parseRetorno({ registros: [{ inscricaoImobiliaria: 'T.1', cib: 'BBBB2222', operacao: 'Inclusão', efetivado: true, falhas: [] }] }), { origem: 'arquivo' });
  assert.equal(r3.ignorados, 1);
  assert.equal((await db.query(`SELECT cib FROM imoveis WHERE municipio = $1 AND inscricao = 'T.1'`, [M])).rows[0].cib, 'AAAA1111');
  const st = (await db.query('SELECT qtd_ok, qtd_erro, status FROM cib_remessas WHERE id = $1', [remessa.id])).rows[0];
  assert.deepEqual(st, { qtd_ok: 1, qtd_erro: 1, status: 'processada_com_erros' });
  // reprocessamento do rejeitado: volta à fila, sem duplicar o imóvel
  const rp = await rem.reprocessar(M, null, 't');
  assert.deepEqual([rp.analisados, rp.reenfileirados], [1, 1]);
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM imoveis WHERE municipio = $1 AND inscricao = 'T.2'`, [M])).rows[0].n, 1);
  const prox = await rem.prepararRemessa(M, { usuario: 't' });
  assert.equal(prox.remessa.numero, remessa.numero + 1, 'numeração transacional e contínua');
});

test('importação incremental: idempotente e com relatório', { skip: pular }, async () => {
  const csv = 'inscricao;logradouro;bairro;area construida\nT.1;Rua A;Centro;100\nT.9;Rua Nova;Centro;0\n';
  const a = await imp.importarCsv({ municipio: M, texto: csv, arquivoNome: 'a.csv', arquivoSha256: 'h1' });
  assert.equal(a.totais.inalterado, 1);
  assert.equal(a.totais.novo, 1);
  const b = await imp.importarCsv({ municipio: M, texto: csv, arquivoNome: 'a.csv', arquivoSha256: 'h1' });
  assert.equal(b.repetida, true);
  const c = await imp.importarCsv({ municipio: M, texto: csv, arquivoNome: 'a.csv', arquivoSha256: 'h1', forcar: true });
  assert.deepEqual([c.totais.novo, c.totais.alterado], [0, 0], 'reprocessar o mesmo conteúdo não muda nada');
  const n = (await db.query(`SELECT COUNT(*)::int AS n FROM cib_movimentacoes WHERE municipio = $1 AND inscricao = 'T.9'`, [M])).rows[0].n;
  assert.equal(n, 1, 'inclusão pendente não duplica');
  const d = await imp.importarCsv({ municipio: M, texto: csv.replace(';100', ';150'), arquivoNome: 'b.csv', arquivoSha256: 'h2' });
  assert.equal(d.totais.alterado, 1);
  const it = (await db.query(`SELECT campos FROM cib_importacao_itens WHERE importacao_id = $1 AND inscricao = 'T.1'`, [d.id])).rows[0];
  assert.deepEqual(it.campos.area_construida_m2, { antes: 100, depois: 150 });
});

test('PGV: publicar exercício não altera certidão já emitida', { skip: pular }, async () => {
  const pgv = await import('../src/pgv.js');
  await db.query(`INSERT INTO pgv_exercicios (municipio, ano, status) VALUES ($1, 2030, 'rascunho')`, [M]);
  await db.query(`INSERT INTO pgv_valores (municipio, ano, tipo, chave, valor_m2) VALUES ($1, 2030, 'terreno', '*', 100), ($1, 2030, 'construcao', 'normal', 1000)`, [M]);
  await pgv.publicarExercicio(M, 2030, { usuario: 't' });
  const im = (await db.query(`SELECT id FROM imoveis WHERE municipio = $1 AND inscricao = 'T.1'`, [M])).rows[0];
  const cert = await docs.emitirDocumento({ municipio: M, tipo: 'certidao_valor_venal', imovelId: im.id, usuario: 't' });
  const antes = cert.conteudo.imovel.valorVenal;
  assert.equal(cert.conteudo.exercicio, 2030);
  await db.query(`INSERT INTO pgv_exercicios (municipio, ano, status) VALUES ($1, 2031, 'rascunho')`, [M]);
  await db.query(`INSERT INTO pgv_valores (municipio, ano, tipo, chave, valor_m2) VALUES ($1, 2031, 'terreno', '*', 999), ($1, 2031, 'construcao', 'normal', 9999)`, [M]);
  await pgv.publicarExercicio(M, 2031, { usuario: 't' });
  const depois = (await db.query('SELECT conteudo FROM documentos WHERE id = $1', [cert.id])).rows[0].conteudo.imovel.valorVenal;
  assert.equal(depois, antes, 'certidão congelada');
  const novo = (await db.query('SELECT valor_venal_total::float AS v, valor_venal_ano FROM imoveis WHERE id = $1', [im.id])).rows[0];
  assert.equal(novo.valor_venal_ano, 2031);
  assert.notEqual(novo.v, antes);
  await assert.rejects(pgv.publicarExercicio(M, 2030, {}), /já está/);
});

test('portal: documento do cidadão guarda canal/solicitante, imutável; requerimento com anexos somente-inserção', { skip: pular }, async () => {
  const im = (await db.query(`SELECT id FROM imoveis WHERE municipio = $1 LIMIT 1`, [M])).rows[0];
  const d = await docs.emitirDocumento({ municipio: M, tipo: 'certidao_cadastral', imovelId: im.id, usuario: 'Portal do Cidadão', canal: 'portal', solicitanteDoc: '529.982.247-25' });
  assert.equal(d.canal, 'portal');
  assert.equal(d.solicitante_doc, '52998224725');
  await assert.rejects(db.query(`UPDATE documentos SET solicitante_doc = '11144477735' WHERE id = $1`, [d.id]), /imutável/);
  await assert.rejects(db.query(`UPDATE documentos SET canal = 'interno' WHERE id = $1`, [d.id]), /imutável/);
  const { validarAnexos } = await import('../src/anexos.js');
  const pdf = Buffer.from('%PDF-1.4\n%%EOF').toString('base64');
  const r = await docs.protocolarRequerimento({ municipio: M, tipo: 'revisao_cadastral', requerenteNome: 'Fulano', requerenteDoc: '52998224725', imovelId: im.id,
    descricao: 'teste do portal', usuario: 't', canal: 'portal', anexos: validarAnexos([{ nome: 'a.pdf', base64: pdf }]) });
  assert.equal(r.canal, 'portal');
  assert.equal(r.qtd_anexos, 1);
  const a = (await db.query('SELECT id, tipo_mime FROM requerimento_anexos WHERE requerimento_id = $1', [r.id])).rows[0];
  assert.equal(a.tipo_mime, 'application/pdf');
  await assert.rejects(db.query(`UPDATE requerimento_anexos SET nome = 'x' WHERE id = $1`, [a.id]), /somente-inserção/);
  await assert.rejects(db.query(`DELETE FROM requerimento_anexos WHERE id = $1`, [a.id]), /somente-inserção/);
});
