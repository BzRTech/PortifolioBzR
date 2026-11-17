// Regras de validação: CPF, CNPJ (numérico e alfanumérico), CNM e imóvel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpfValido, cnpjValido, dvCnpj, niValido, normalizarNi, mascararDoc, formatarDoc, cnmValido, dvCnm, cnpjAlfanumerico } from '../src/ni.js';
import { validarImovel, temErro, jcs } from '../src/cib-validacao.js';

test('CPF: válidos, inválidos e repetidos', () => {
  assert.ok(cpfValido('529.982.247-25'));
  assert.ok(cpfValido('52998224725'));
  assert.ok(!cpfValido('529.982.247-24'));
  assert.ok(!cpfValido('111.111.111-11'));
  assert.ok(!cpfValido('1234567890'));
});

test('CNPJ numérico continua válido', () => {
  assert.ok(cnpjValido('11.222.333/0001-81'));
  assert.ok(!cnpjValido('11.222.333/0001-80'));
  assert.ok(!cnpjValido('00000000000000'));
});

test('CNPJ alfanumérico — exemplo oficial da Receita (12.ABC.345/01DE-35)', () => {
  assert.equal(dvCnpj('12ABC34501DE'), '35');
  assert.ok(cnpjValido('12.ABC.345/01DE-35'));
  assert.ok(cnpjValido('12abc34501de35'), 'aceita minúsculas e normaliza');
  assert.ok(!cnpjValido('12.ABC.345/01DE-36'));
  assert.ok(!cnpjValido('12.ABC.345/01DE-3A'), 'DVs são sempre numéricos');
  assert.ok(cnpjAlfanumerico('12ABC34501DE35'));
  assert.ok(niValido('12.ABC.345/01DE-35'));
});

test('normalização, máscara (LGPD) e formatação de NI', () => {
  assert.equal(normalizarNi(' 12.abc.345/01de-35 '), '12ABC34501DE35');
  assert.equal(mascararDoc('52998224725'), '***.982.247-**');
  assert.equal(mascararDoc('12ABC34501DE35'), '**.ABC.345/01DE-**');
  assert.equal(formatarDoc('12ABC34501DE35'), '12.ABC.345/01DE-35');
});

test('CNM da matrícula (ISO 7064 mod 97-10, livro 2)', () => {
  const base = '12345621234567';
  const cnm = base + dvCnm(base);
  assert.ok(cnmValido(cnm));
  assert.ok(!cnmValido(cnm.slice(0, 15) + ((Number(cnm[15]) + 1) % 10)));
  assert.ok(!cnmValido('1234561234567' + '12'), 'livro precisa ser 2');
});

const BASE = {
  inscricao: '01.02.0003', tipo: 'predial', tp_arquitetonico: 1, destinacao: 1, logradouro: 'Rua das Flores', numero: '12',
  bairro: 'Centro', cep: '58700000', area_terreno_m2: 300, area_construida_m2: 120, contribuinte_nome: 'Ana', contribuinte_doc: '52998224725',
  lote_id: 1, lote_area_m2: 300, matricula_cartorio: '123',
};
const erros = (im) => validarImovel(im).filter((p) => p.nivel === 'erro').map((p) => p.falhaSinter || p.codigo);

test('imóvel predial completo: pronto para o Sinter', () => {
  assert.equal(temErro(validarImovel(BASE)), false);
});
test('predial sem tipo arquitetônico → falha 0012 (bloqueia CIB)', () => {
  assert.deepEqual(erros({ ...BASE, tp_arquitetonico: null }), ['0012']);
});
test('predial sem destinação → falha 0015', () => {
  assert.ok(erros({ ...BASE, destinacao: null, uso: '' }).includes('0015'));
});
test('destinação deduzida do uso quando não informada', () => {
  assert.equal(temErro(validarImovel({ ...BASE, destinacao: null, uso: 'Comercial' })), false);
});
test('CEP obrigatório (8 dígitos) e bairro até 30 caracteres', () => {
  assert.ok(erros({ ...BASE, cep: '' }).includes('0001'));
  assert.ok(erros({ ...BASE, cep: '5870' }).includes('0002'));
  assert.ok(erros({ ...BASE, bairro: 'x'.repeat(31) }).includes('0003'));
});
test('tipo de logradouro: deduzido do nome; inválido quando não dá para deduzir', () => {
  assert.equal(temErro(validarImovel({ ...BASE, logradouro: 'Avenida Brasil' })), false);
  assert.ok(erros({ ...BASE, logradouro: 'Brasil' }).includes('0001'));
});
test('territorial com área construída: não bloqueia, mas gera alerta de qualidade', () => {
  const p = validarImovel({ ...BASE, tipo: 'territorial' });
  assert.equal(temErro(p), false);
  assert.ok(p.some((x) => x.codigo === 'TERRITORIAL_COM_AREA'));
});
test('BICE obrigatório para tipo especial (3)', () => {
  assert.ok(erros({ ...BASE, tipo: 'especial' }).includes('0013'));
  assert.equal(temErro(validarImovel({ ...BASE, tipo: 'especial', bice: 8 })), false);
});
test('CPF/CNPJ inválido do contribuinte é alerta (não impede o CIB)', () => {
  const p = validarImovel({ ...BASE, contribuinte_doc: '52998224724' });
  assert.equal(temErro(p), false);
  assert.ok(p.some((x) => x.codigo === 'DOC_INVALIDO' && x.nivel === 'alerta'));
});

test('JCS (RFC 8785): ordem de chaves e números estáveis', () => {
  assert.equal(jcs({ b: 1, a: [true, null, 'x'], c: { z: 0.5, y: -0 } }), '{"a":[true,null,"x"],"b":1,"c":{"y":0,"z":0.5}}');
  assert.equal(jcs({ a: 1, b: 2 }), jcs({ b: 2, a: 1 }));
  assert.equal(jcs({ a: undefined, b: 1 }), '{"b":1}');
  assert.throws(() => jcs({ a: NaN }));
});
