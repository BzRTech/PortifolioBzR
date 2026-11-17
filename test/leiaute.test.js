// Gerador de remessa no leiaute oficial do Sinter (Manual Operacional 1.17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarUI, validarUI, montarRegistro, gerarNdjson, nomeSemTipo, tipoLogradouroDoNome, validarDesativacao, LEIAUTE } from '../src/sinter/leiaute.js';
import { criarZip, lerZip } from '../src/sinter/zip.js';
import { TIPO_LOGRADOURO, CODIGOS_FALHA, MOTIVO_DESATIVACAO } from '../src/sinter/dominios.js';

const IM = {
  inscricao: '01.02.0003', tipo: 'predial', tp_arquitetonico: 1, destinacao: 1, logradouro: 'Rua das Flores', numero: '12',
  bairro: 'Centro', cep: '58700000', area_terreno_m2: 300.123456, area_construida_m2: 120, ano_construcao: 1990, padrao_construtivo: 'normal',
  contribuinte_nome: 'Ana Souza', contribuinte_doc: '52998224725', titular_tipo: 1, titular_doc_tipo: 1, titular_dt_aquisicao: '2010-05-20',
  valor_venal_total: 250000.456, valor_venal_ano: 2026, cib: '',
};

test('domínios oficiais carregados', () => {
  assert.equal(Object.keys(TIPO_LOGRADOURO).length, 311);
  assert.equal(TIPO_LOGRADOURO['250'], 'Rua');
  assert.equal(CODIGOS_FALHA['0011'].startsWith("Para este 'tipoImovel'"), true);
  assert.deepEqual(MOTIVO_DESATIVACAO['9'].tipos, [2]);
  assert.equal(LEIAUTE.versaoManual, '1.17');
});

test('UI completa: grupos e nomes de campo do payload oficial', () => {
  const { ui, avisos } = montarUI(IM);
  assert.deepEqual(Object.keys(ui).sort(), ['DadosGeraisImovel', 'EnderecoImovel', 'Titular']);
  const d = ui.DadosGeraisImovel;
  assert.equal(d.inscricaoImobiliaria, '01.02.0003');
  assert.equal(d.tipoImovel, 2);
  assert.equal(d.tpArquitetonico, 1);
  assert.equal(d.destinacaoImovel, 1);
  assert.equal(d.areaTerreno, 300.1235, '4 casas decimais');
  assert.equal(d.temBairro, true);
  assert.equal(d.padraoConstrutivo, 3);
  assert.equal(d.valorVenal, 250000.46, '2 casas decimais');
  assert.equal(d.dtUltimoValorVenal, '2026-01-01');
  assert.deepEqual(ui.EnderecoImovel, { tipoLogradouro: 250, nomeLogradouro: 'das Flores', cep: '58700000', bairro: 'Centro', numeroImovel: '12' });
  assert.deepEqual(ui.Titular, [{ nomeTitular: 'Ana Souza', percTitularidade: 1, dtAquisicaoTitular: '2010-05-20', tipoTitularidade: 1, docTitularidade: 1, niTitular: '52998224725' }]);
  assert.equal(avisos.length, 0);
  assert.deepEqual(validarUI(ui, 'I'), []);
});

test('territorial: não envia tpArquitetonico, areaConstruida nem anoConstrutivo', () => {
  const { ui } = montarUI({ ...IM, tipo: 'territorial' });
  const d = ui.DadosGeraisImovel;
  assert.equal(d.tipoImovel, 1);
  for (const c of ['tpArquitetonico', 'areaConstruida', 'anoConstrutivo', 'padraoConstrutivo']) assert.ok(!(c in d), c);
  assert.equal(validarUI(ui, 'I').filter((f) => f.nivel === 'erro').length, 0);
});

test('regras condicionais do tipoImovel (falhas 0011, 0012, 0013, 0014, 0015)', () => {
  const base = { DadosGeraisImovel: { inscricaoImobiliaria: 'X', tipoImovel: 1, temBairro: false, areaTerreno: 10, areaConstruida: 5 }, EnderecoImovel: { tipoLogradouro: 250, nomeLogradouro: 'A', cep: '58700000' } };
  assert.ok(validarUI(base).some((f) => f.codigo === '0011'));
  const pred = structuredClone(base); pred.DadosGeraisImovel.tipoImovel = 2; delete pred.DadosGeraisImovel.areaConstruida;
  assert.ok(validarUI(pred).some((f) => f.codigo === '0012'));
  assert.ok(validarUI(pred).some((f) => f.codigo === '0015'));
  const esp = structuredClone(base); esp.DadosGeraisImovel.tipoImovel = 3;
  assert.ok(validarUI(esp).some((f) => f.codigo === '0013'));
  const bai = structuredClone(base); bai.DadosGeraisImovel.temBairro = true; delete bai.DadosGeraisImovel.areaConstruida;
  assert.ok(validarUI(bai).some((f) => f.codigo === '0014'));
});

test('tamanhos e formatos', () => {
  const { ui } = montarUI({ ...IM, inscricao: 'x'.repeat(46), cep: '587000', numero: '123456789' });
  const cods = validarUI(ui).map((f) => `${f.codigo}:${f.nivel}:${f.campo.split('.').pop()}`);
  assert.ok(cods.includes('0003:erro:inscricaoImobiliaria'));
  assert.ok(cods.includes('0002:erro:cep'));
  assert.ok(cods.includes('0103:alerta:numeroImovel'));
});

test('titular incompleto não é enviado (alerta 0108); CNPJ alfanumérico fica fora do niTitular', () => {
  const inc = montarUI({ ...IM, titular_tipo: null });
  assert.ok(!inc.ui.Titular);
  assert.ok(inc.avisos.some((a) => a.codigo === '0108'));
  const alfa = montarUI({ ...IM, contribuinte_doc: '12ABC34501DE35' });
  assert.equal(alfa.ui.Titular[0].niTitular, undefined);
  assert.ok(alfa.avisos.some((a) => /alfanumérico/.test(a.mensagem)));
});

test('nome do logradouro sem o tipo; tipo deduzido do prefixo', () => {
  assert.equal(nomeSemTipo('Av. Brasil', 26), 'Brasil');
  assert.equal(nomeSemTipo('Travessa do Comércio', 273), 'do Comércio');
  assert.equal(tipoLogradouroDoNome('Rua X'), 250);
  assert.equal(tipoLogradouroDoNome('Brasil'), null);
});

test('registro por operação: I, A (exige cib), D (desativação) e reativação sem operação', () => {
  assert.equal(montarRegistro({ tipo: 'inclusao' }, IM).registro.operacao, 'I');
  const a = montarRegistro({ tipo: 'alteracao' }, { ...IM, cib: 'M65SBES1' });
  assert.equal(a.registro.operacao, 'A');
  assert.equal(a.registro.ui.cib, 'M65SBES1');
  const semCib = montarRegistro({ tipo: 'alteracao' }, IM);
  assert.equal(semCib.ok, false, 'alteração sem CIB fica fora da remessa até o retorno da inclusão');
  assert.ok(semCib.falhas.some((f) => f.campo === 'cib'));
  const d = montarRegistro({ tipo: 'baixa', inscricao: IM.inscricao, desativacao_tipo: 1, desativacao_motivo: 1, descricao: 'Desmembramento' }, { ...IM, cib: 'M65SBES1' });
  assert.deepEqual(d.registro, { ui: { inscricaoImobiliaria: '01.02.0003', cib: 'M65SBES1', tipoDesativacao: 1, motivoDesativacao: 1, complemento: 'Desmembramento' }, operacao: 'D' });
  assert.ok(d.ok);
  assert.equal(montarRegistro({ tipo: 'baixa', desativacao_tipo: 1, desativacao_motivo: 1 }, IM).ok, false, 'D sem CIB é rejeitado no leiaute');
  assert.equal(montarRegistro({ tipo: 'reativacao' }, IM).ok, false);
  assert.equal(montarRegistro({ tipo: 'inclusao' }, { ...IM, cib: 'M65SBES1' }).ok, false, 'inclusão de quem já tem CIB');
});

test('motivo × tipo de desativação (tabela oficial)', () => {
  assert.equal(validarDesativacao({ inscricaoImobiliaria: 'X', cib: 'C', tipoDesativacao: 2, motivoDesativacao: 1 }).at(0).codigo, '0101');
  assert.deepEqual(validarDesativacao({ inscricaoImobiliaria: 'X', cib: 'C', tipoDesativacao: 2, motivoDesativacao: 9 }), []);
  assert.deepEqual(validarDesativacao({ inscricaoImobiliaria: 'X', cib: 'C', tipoDesativacao: 1, motivoDesativacao: 6 }), []);
});

test('NDJSON compacto + ZIP legível', () => {
  const regs = [montarRegistro({ tipo: 'inclusao' }, IM).registro, montarRegistro({ tipo: 'inclusao' }, { ...IM, inscricao: '01.02.0004' }).registro];
  const nd = gerarNdjson(regs);
  const linhas = nd.trimEnd().split('\n');
  assert.equal(linhas.length, 2);
  for (const l of linhas) { assert.ok(!l.includes('\n')); const o = JSON.parse(l); assert.ok(o.ui && ['I', 'A', 'D'].includes(o.operacao)); }
  const [arq] = lerZip(criarZip([{ nome: 'remessa.ndjson', conteudo: nd }]));
  assert.equal(arq.nome, 'remessa.ndjson');
  assert.ok(arq.crcOk);
  assert.equal(arq.conteudo.toString('utf8'), nd);
});
