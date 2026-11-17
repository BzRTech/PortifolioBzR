// Parser de retorno do Sinter e leitor de CSV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRetorno } from '../src/sinter/retorno.js';
import { parseCsv } from '../src/csv.js';

// Trecho real do exemplo "Consultar processamento e falhas" do manual (com os espaços espúrios do PDF).
const OFICIAL = {
  idRequisicao: 425, codigoIbgeMunicipio: 3106200, pagina: 1, ultimaPagina: true,
  registros: [
    { operacao: 'Inclusão', efetivado: false, falhas: [{ codigoFalha: '0004', camposFalha: 'dadosG eraisImovel.tipoImovel' }] },
    { inscricaoImobiliaria: '0000000000002970264435404', cib: 'SCRZ1R3 4', operacao: 'Inclusão ', efetivado: true,
      falhas: [{ codigoFalha: '0 103', camposFalha: 'servicoRegistroImovel.numUltimoAtoRI', complemento: 'max:7' }] },
    { inscricaoImobiliaria: '0000000000003000967223889', operacao: 'Inclusão', efetivado: false,
      falhas: [{ camposFalha: 'dadosGeraisImovel.tpArquitetonico, dadosGeraisImovel.areaConstruida, dadosGeraisImovel.tipoImovel', codigoFalha: '0011' }] },
  ],
};

test('consulta oficial: efetivado, rejeitado, falhas e limpeza de espaços', () => {
  const r = parseRetorno(OFICIAL);
  assert.equal(r.length, 3);
  assert.equal(r[0].inscricao, '', 'registro sem inscrição (JSON inválido no envio)');
  assert.equal(r[1].cib, 'SCRZ1R34');
  assert.equal(r[1].operacao, 'I');
  assert.equal(r[1].efetivado, true);
  assert.equal(r[1].situacao, 'ok_com_falhas');
  assert.equal(r[1].falhas[0].codigo, '0103');
  assert.equal(r[2].situacao, 'erro');
  assert.deepEqual(r[2].falhas[0].campos, ['dadosGeraisImovel.tpArquitetonico', 'dadosGeraisImovel.areaConstruida', 'dadosGeraisImovel.tipoImovel']);
  assert.match(r[2].mensagem, /0011/);
});

test('várias páginas e texto JSON', () => {
  const r = parseRetorno(JSON.stringify([OFICIAL, { registros: [{ inscricaoImobiliaria: 'A1', cib: 'X', operacao: 'Alteração', efetivado: true, falhas: [] }] }]));
  assert.equal(r.length, 4);
  assert.equal(r[3].operacao, 'A');
  assert.equal(r[3].situacao, 'ok');
});

test('resposta síncrona (uiIncluida/camposInvalidos)', () => {
  const [r] = parseRetorno({ id: 1, uiIncluida: { inscricaoImobiliaria: '99', cib: { valor: 'M65SBES1', situacao: 'Ativa' } }, camposInvalidos: [{ campo: 'titular.niTitular', erro: 'Ni do titular inválido.', idFalha: '0103 ' }] });
  assert.equal(r.cib, 'M65SBES1');
  assert.equal(r.efetivado, true);
  assert.equal(r.falhas[0].codigo, '0103');
});

test('CSV manual: BOM, ; , aspas e situação', () => {
  const csv = '﻿inscricao;situacao;cib;campo;valor_externo;mensagem\r\n01.01;ok;ABC12345;;;\r\n"01.02";divergente;;area_terreno_m2;310;"Área ""diverge"""\r\n01.03;rejeitado;;;;Logradouro\n';
  const r = parseRetorno(csv);
  assert.equal(r.length, 3);
  assert.deepEqual([r[0].situacao, r[1].situacao, r[2].situacao], ['ok', 'divergente', 'erro']);
  assert.equal(r[1].valorExterno, '310');
  assert.equal(r[1].mensagem, 'Área "diverge"');
});

test('leitor de CSV: separador detectado, quebra de linha dentro de aspas, linhas vazias', () => {
  const { cabecalho, linhas, separador } = parseCsv('a,b,c\n1,"x\ny",3\n\n4,5,6\n');
  assert.equal(separador, ',');
  assert.deepEqual(cabecalho, ['a', 'b', 'c']);
  assert.deepEqual(linhas, [['1', 'x\ny', '3'], ['4', '5', '6']]);
  assert.equal(parseCsv('a\tb\n1\t2').separador, '\t');
});
