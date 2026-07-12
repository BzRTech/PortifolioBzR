// Catalogo de campos do BCI (Boletim de Cadastro Imobiliario) — formulario
// PADRAO, transcrito do BCI oficial de Malta-PB. O catalogo e versionavel por
// municipio no banco (tabela bci_formulario); este e o fallback padrao.
//
// Tipos de campo: texto | inteiro | decimal | booleano | select | data.

export const BCI_PADRAO = {
  nome: 'BCI padrão',
  versao: 1,
  secoes: [
    {
      id: '00', titulo: 'Identificação', campos: [
        { key: 'setor_responsavel', label: 'Setor', tipo: 'select', opcoes: ['Tributos', 'Urbano'] },
        { key: 'controle_interno', label: 'Controle interno', tipo: 'texto' },
        { key: 'data_preenchimento', label: 'Data', tipo: 'data' },
        { key: 'processo_numero', label: 'Processo nº', tipo: 'texto' },
        { key: 'codigo_operacao', label: 'Cód. operação', tipo: 'texto' },
        { key: 'responsavel_preenchimento', label: 'Resp. pelo preenchimento', tipo: 'texto' },
        { key: 'inscricao_geral', label: 'Inscrição geral do imóvel', tipo: 'texto' },
      ],
    },
    {
      id: '01', titulo: 'Localização do imóvel', campos: [
        { key: 'nome_logradouro', label: 'Nome do logradouro', tipo: 'texto' },
        { key: 'cep', label: 'CEP', tipo: 'texto' },
        { key: 'numero_imovel', label: 'Nº do imóvel', tipo: 'texto' },
        { key: 'setor', label: 'Setor', tipo: 'texto' },
        { key: 'quadra', label: 'Quadra', tipo: 'texto' },
        { key: 'lote', label: 'Lote', tipo: 'texto' },
        { key: 'face', label: 'Face', tipo: 'texto' },
      ],
    },
    {
      id: '02', titulo: 'Identificação do proprietário', campos: [
        { key: 'tipo_imovel', label: 'Tipo do imóvel', tipo: 'select', opcoes: ['Predial', 'Territorial', 'Outro'] },
        { key: 'nome_proprietario', label: 'Nome do proprietário', tipo: 'texto' },
        { key: 'cpf_cnpj', label: 'CPF/CNPJ', tipo: 'texto' },
        { key: 'endereco_correspondencia', label: 'Endereço para correspondência', tipo: 'texto' },
        { key: 'uc_energisa', label: 'UC Energisa', tipo: 'texto' },
        { key: 'contato', label: 'Contato', tipo: 'texto' },
        { key: 'prop_cidade', label: 'Cidade', tipo: 'texto' },
        { key: 'prop_numero', label: 'Nº', tipo: 'texto' },
        { key: 'prop_bairro', label: 'Bairro', tipo: 'texto' },
        { key: 'prop_cep', label: 'CEP', tipo: 'texto' },
      ],
    },
    {
      id: '03', titulo: 'Informação geral do imóvel', campos: [
        { key: 'patrimonio', label: 'Patrimônio', tipo: 'select', opcoes: ['Privado - Pessoa Física', 'Privado - Pessoa Jurídica', 'Religioso', 'Público - Federal', 'Público - Estadual', 'Público - Municipal', 'Outro'] },
        { key: 'uso_do_solo', label: 'Uso do solo', tipo: 'select', opcoes: ['Terreno vazio', 'Residencial', 'Comercial/Serviços', 'Institucional', 'Religioso', 'Industrial', 'Misto'] },
        { key: 'propriedade', label: 'Propriedade', tipo: 'select', opcoes: ['Registrada', 'Contrato', 'Posse', 'Usucapião', 'Nenhum', 'Outro'] },
        { key: 'abastecimento_agua', label: 'Abastecimento de água', tipo: 'select', opcoes: ['Rede Pública', 'Solução Individual', 'Não Possui'] },
        { key: 'limites_definidos', label: 'Limites definidos', tipo: 'select', opcoes: ['Murado', 'Cercado', 'Outro', 'Sem limites definidos'] },
        { key: 'eletricidade', label: 'Eletricidade', tipo: 'select', opcoes: ['Rede', 'Outro', 'Não Possui'] },
        { key: 'cisterna', label: 'Cisterna', tipo: 'booleano' },
        { key: 'fossa_sanitaria', label: 'Fossa sanitária', tipo: 'booleano' },
        { key: 'energia_renovavel', label: 'Energia renovável', tipo: 'booleano' },
      ],
    },
    {
      id: '04', titulo: 'Terreno', campos: [
        { key: 'situacao_quadra', label: 'Situação na quadra', tipo: 'select', opcoes: ['Esquina', 'Frente/Gaveta', 'Duas ou mais frentes', 'Outros', 'Fundos'] },
        { key: 'area_lote_m2', label: 'Área do lote (m²)', tipo: 'decimal' },
        { key: 'testada_principal_m', label: 'Testada principal (m)', tipo: 'decimal' },
        { key: 'profundidade_m', label: 'Profundidade (m)', tipo: 'decimal' },
        { key: 'recuo_frontal_m', label: 'Recuo frontal', tipo: 'decimal' },
        { key: 'total_unidades', label: 'Total de unidades', tipo: 'inteiro' },
        { key: 'num_pavimentos', label: 'Nº de pavimentos', tipo: 'inteiro' },
        { key: 'area_construida_m2', label: 'Área construída (m²)', tipo: 'decimal' },
        { key: 'estacionamento', label: 'Vagas de estacionamento', tipo: 'select', opcoes: ['Sim', 'Não Possui'] },
        { key: 'vagas_qtd', label: 'Qtd. de vagas', tipo: 'inteiro' },
        { key: 'piscina', label: 'Piscina', tipo: 'booleano' },
        { key: 'topografia', label: 'Topografia', tipo: 'select', opcoes: ['Plano', 'Aclive', 'Declive', 'Irregular'] },
        { key: 'pedologia', label: 'Pedologia', tipo: 'select', opcoes: ['Inundável', 'Firme', 'Alagado', 'Mangue', 'Rochoso', 'Arenoso', 'Outro'] },
      ],
    },
    {
      id: '05', titulo: 'Edificação', campos: [
        { key: 'especie_edificacao', label: 'Espécie da edificação', tipo: 'select', opcoes: ['Apartamento', 'Casa Isolada', 'Casa Geminada', 'Loja/Sala', 'Galpão', 'Escola', 'Ginásio', 'Banco', 'Prédio Público', 'Casa de Vila', 'Indústria', 'Outro'] },
        { key: 'ocupacao', label: 'Ocupação', tipo: 'select', opcoes: ['Construída - Ocupada', 'Construída - Fechada', 'Vago/Abandonado', 'Ruínas', 'Obra Paralisada', 'Obra em andamento', 'Temporário'] },
      ],
    },
    {
      id: '06', titulo: 'Padrão construtivo', campos: [
        { key: 'estrutura_elevacao', label: 'Estrutura/Elevação', tipo: 'select', opcoes: ['Madeira', 'Metálica', 'Alvenaria/Concreto', 'Mista', 'Outro'] },
        { key: 'piso', label: 'Piso', tipo: 'select', opcoes: ['Cimentado', 'Cerâmica', 'Madeira', 'Barro', 'Outros'] },
        { key: 'vedacao', label: 'Vedação', tipo: 'select', opcoes: ['Sem vedação', 'Taipa', 'Alvenaria', 'Madeira', 'Mista'] },
        { key: 'cobertura', label: 'Cobertura', tipo: 'select', opcoes: ['Telha Cerâmica', 'Fibrocimento', 'Laje Impermeabilizada', 'Zinco/Metálica', 'Outros'] },
        { key: 'esquadrias', label: 'Esquadrias', tipo: 'select', opcoes: ['Madeira', 'Metálica', 'Vidro', 'Mista', 'Outras'] },
        { key: 'elevador', label: 'Elevador', tipo: 'booleano' },
      ],
    },
    {
      id: '07', titulo: 'Outras informações de cadastro', campos: [
        { key: 'veiculos_automoveis', label: 'Automóveis (qtd.)', tipo: 'inteiro' },
        { key: 'veiculos_motocicletas', label: 'Motocicletas (qtd.)', tipo: 'inteiro' },
        { key: 'saude_da_familia', label: 'Atendimento Saúde da Família', tipo: 'booleano' },
        { key: 'pessoas_ate_11', label: 'Pessoas até 11 anos', tipo: 'inteiro' },
        { key: 'pessoas_11_14', label: 'Pessoas 11 a 14 anos', tipo: 'inteiro' },
        { key: 'pessoas_14_18', label: 'Pessoas 14 a 18 anos', tipo: 'inteiro' },
        { key: 'pessoas_18_25', label: 'Pessoas 18 a 25 anos', tipo: 'inteiro' },
        { key: 'pessoas_25_60', label: 'Pessoas 25 a 60 anos', tipo: 'inteiro' },
        { key: 'pessoas_acima_60', label: 'Pessoas acima de 60 anos', tipo: 'inteiro' },
        { key: 'bolsa_familia', label: 'Cadastrado no Bolsa Família', tipo: 'booleano' },
        { key: 'numero_familias', label: 'Número de famílias', tipo: 'select', opcoes: ['Somente uma família', 'Mais de uma'] },
        { key: 'numero_familias_qtd', label: 'Se mais de uma, quantas', tipo: 'inteiro' },
      ],
    },
    {
      id: '08', titulo: 'Encerramento', campos: [
        { key: 'local_data', label: 'Local e data', tipo: 'texto' },
        { key: 'visto_contribuinte', label: 'Visto do contribuinte', tipo: 'texto' },
      ],
    },
  ],
};

/** { key: campo } achatado, para validação/lookup rápido. */
export function flattenCampos(definicao) {
  const out = {};
  for (const secao of (definicao?.secoes || [])) {
    for (const campo of (secao.campos || [])) out[campo.key] = campo;
  }
  return out;
}
