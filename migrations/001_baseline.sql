-- 001_baseline — schema da plataforma BzR no estado do commit c05881d
-- (Território, O.S., auth, Demandas, BCI, CIB/Sinter, Documentos).
-- Gerado com pg_dump -s a partir de um banco criado pelas antigas funções
-- ensure*Schema. Bancos já existentes (criados antes das migrations) são
-- "adotados": o migrador aplica as funções legadas e marca esta versão como
-- aplicada sem executá-la (ver src/migrate.js).
--
-- PostgreSQL database dump
--

-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;

--
-- Name: bairros; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bairros (
    id bigint NOT NULL,
    municipio text,
    nome text,
    populacao integer,
    area_m2 double precision,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    geom public.geometry(MultiPolygon,4326)
);

--
-- Name: bairros_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.bairros ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.bairros_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: bci; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bci (
    id bigint NOT NULL,
    lote_id bigint,
    inscricao text DEFAULT ''::text NOT NULL,
    municipio text DEFAULT ''::text,
    bairro text DEFAULT ''::text,
    tecnico_nome text DEFAULT ''::text,
    status text DEFAULT 'rascunho'::text NOT NULL,
    dados jsonb DEFAULT '{}'::jsonb NOT NULL,
    area_terreno_m2 double precision,
    area_construida_m2 double precision,
    uso text DEFAULT ''::text,
    observacoes text DEFAULT ''::text,
    ponto_lat double precision,
    ponto_lng double precision,
    precisao_gps_m double precision,
    enviado_em timestamp with time zone,
    aprovado_em timestamp with time zone,
    aprovado_por_nome text DEFAULT ''::text,
    motivo_rejeicao text DEFAULT ''::text,
    ajuste_geom boolean DEFAULT false NOT NULL,
    ajuste_tipo text DEFAULT ''::text,
    ajuste_obs text DEFAULT ''::text,
    ajuste_inscricoes text DEFAULT ''::text,
    ajuste_resolvido boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: bci_formulario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bci_formulario (
    id bigint NOT NULL,
    municipio text,
    nome text NOT NULL,
    versao integer DEFAULT 1 NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    definicao jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: bci_formulario_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.bci_formulario ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.bci_formulario_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: bci_foto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bci_foto (
    id bigint NOT NULL,
    bci_id bigint NOT NULL,
    imagem text NOT NULL,
    tipo text DEFAULT 'geral'::text NOT NULL,
    legenda text DEFAULT ''::text,
    lat double precision,
    lng double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: bci_foto_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.bci_foto ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.bci_foto_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: bci_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.bci ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.bci_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: cib_auditoria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cib_auditoria (
    id bigint NOT NULL,
    municipio text DEFAULT ''::text NOT NULL,
    entidade text NOT NULL,
    entidade_id bigint,
    acao text NOT NULL,
    detalhe text DEFAULT ''::text NOT NULL,
    usuario_nome text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: cib_auditoria_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cib_auditoria ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.cib_auditoria_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: cib_divergencias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cib_divergencias (
    id bigint NOT NULL,
    municipio text DEFAULT ''::text NOT NULL,
    imovel_id bigint,
    movimentacao_id bigint,
    remessa_id bigint,
    fonte text DEFAULT 'sinter'::text NOT NULL,
    campo text DEFAULT ''::text NOT NULL,
    valor_municipio text DEFAULT ''::text NOT NULL,
    valor_externo text DEFAULT ''::text NOT NULL,
    mensagem text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'aberta'::text NOT NULL,
    resolucao text DEFAULT ''::text NOT NULL,
    resolvido_por_nome text DEFAULT ''::text NOT NULL,
    resolvido_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: cib_divergencias_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cib_divergencias ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.cib_divergencias_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: cib_implantacao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cib_implantacao (
    municipio text NOT NULL,
    etapa_atual integer DEFAULT 1 NOT NULL,
    etapas jsonb DEFAULT '{}'::jsonb NOT NULL,
    checklist jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: cib_movimentacoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cib_movimentacoes (
    id bigint NOT NULL,
    municipio text DEFAULT ''::text NOT NULL,
    imovel_id bigint,
    inscricao text DEFAULT ''::text NOT NULL,
    tipo text NOT NULL,
    origem text DEFAULT 'manual'::text NOT NULL,
    documento_ref text DEFAULT ''::text NOT NULL,
    descricao text DEFAULT ''::text NOT NULL,
    dados_antes jsonb DEFAULT '{}'::jsonb NOT NULL,
    dados_depois jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'capturada'::text NOT NULL,
    erros jsonb DEFAULT '[]'::jsonb NOT NULL,
    retorno_msg text DEFAULT ''::text NOT NULL,
    remessa_id bigint,
    competencia text NOT NULL,
    criado_por_nome text DEFAULT ''::text NOT NULL,
    validado_em timestamp with time zone,
    transmitido_em timestamp with time zone,
    conciliado_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: cib_movimentacoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cib_movimentacoes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.cib_movimentacoes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: cib_remessas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cib_remessas (
    id bigint NOT NULL,
    municipio text DEFAULT ''::text NOT NULL,
    numero integer NOT NULL,
    competencia text NOT NULL,
    status text DEFAULT 'preparada'::text NOT NULL,
    modo text DEFAULT 'lote'::text NOT NULL,
    protocolo text DEFAULT ''::text NOT NULL,
    qtd_itens integer DEFAULT 0 NOT NULL,
    qtd_ok integer DEFAULT 0 NOT NULL,
    qtd_divergente integer DEFAULT 0 NOT NULL,
    qtd_erro integer DEFAULT 0 NOT NULL,
    hash_arquivo text DEFAULT ''::text NOT NULL,
    obs text DEFAULT ''::text NOT NULL,
    criado_por_nome text DEFAULT ''::text NOT NULL,
    enviada_em timestamp with time zone,
    processada_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: cib_remessas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cib_remessas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.cib_remessas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: cib_vistorias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cib_vistorias (
    id bigint NOT NULL,
    municipio text DEFAULT ''::text NOT NULL,
    lote_id bigint,
    lote_codigo text DEFAULT ''::text NOT NULL,
    imovel_id bigint,
    inscricao text DEFAULT ''::text NOT NULL,
    bairro text DEFAULT ''::text NOT NULL,
    tipo text NOT NULL,
    area_detectada_m2 double precision,
    area_cadastrada_m2 double precision,
    lat double precision,
    lng double precision,
    status text DEFAULT 'pendente'::text NOT NULL,
    demanda_id bigint,
    movimentacao_id bigint,
    obs text DEFAULT ''::text NOT NULL,
    resolvido_por_nome text DEFAULT ''::text NOT NULL,
    resolvido_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: cib_vistorias_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cib_vistorias ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.cib_vistorias_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: demanda_responsaveis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demanda_responsaveis (
    demanda_id bigint NOT NULL,
    usuario_id bigint NOT NULL,
    usuario_nome text DEFAULT ''::text
);

--
-- Name: demandas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demandas (
    id bigint NOT NULL,
    titulo text DEFAULT ''::text NOT NULL,
    descricao text DEFAULT ''::text NOT NULL,
    municipio text DEFAULT ''::text,
    lote_codigo text DEFAULT ''::text,
    lote_bairro text DEFAULT ''::text,
    equipe text DEFAULT ''::text,
    prioridade text DEFAULT 'media'::text NOT NULL,
    status text DEFAULT 'pendente'::text NOT NULL,
    prazo date,
    iniciada_em timestamp with time zone,
    concluida_em timestamp with time zone,
    criado_por bigint,
    criado_por_nome text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: demandas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.demandas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.demandas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: documentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documentos (
    id bigint NOT NULL,
    municipio text DEFAULT ''::text NOT NULL,
    tipo text NOT NULL,
    numero text NOT NULL,
    seq integer NOT NULL,
    ano integer NOT NULL,
    titulo text NOT NULL,
    imovel_id bigint,
    inscricao text DEFAULT ''::text NOT NULL,
    requerimento_id bigint,
    interessado text DEFAULT ''::text NOT NULL,
    conteudo jsonb DEFAULT '{}'::jsonb NOT NULL,
    hash_conteudo text DEFAULT ''::text NOT NULL,
    codigo_validacao text NOT NULL,
    emitido_por_nome text DEFAULT ''::text NOT NULL,
    emitido_em timestamp with time zone DEFAULT now() NOT NULL,
    validade date,
    status text DEFAULT 'valido'::text NOT NULL,
    motivo_cancelamento text DEFAULT ''::text NOT NULL,
    cancelado_em timestamp with time zone
);

--
-- Name: documentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.documentos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.documentos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: edificacoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.edificacoes (
    id bigint NOT NULL,
    municipio text,
    codigo text,
    uso text,
    bairro text,
    n_pavimentos integer,
    area_m2 double precision,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    geom public.geometry(MultiPolygon,4326)
);

--
-- Name: edificacoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.edificacoes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.edificacoes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: imoveis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.imoveis (
    id bigint NOT NULL,
    municipio text DEFAULT ''::text NOT NULL,
    inscricao text NOT NULL,
    lote_id bigint,
    lote_codigo text DEFAULT ''::text NOT NULL,
    cib text DEFAULT ''::text NOT NULL,
    cib_atribuido_em timestamp with time zone,
    situacao text DEFAULT 'ativo'::text NOT NULL,
    data_baixa date,
    motivo_baixa text DEFAULT ''::text NOT NULL,
    tipo text DEFAULT 'predial'::text NOT NULL,
    uso text DEFAULT ''::text NOT NULL,
    setor text DEFAULT ''::text NOT NULL,
    quadra text DEFAULT ''::text NOT NULL,
    lote_num text DEFAULT ''::text NOT NULL,
    logradouro text DEFAULT ''::text NOT NULL,
    numero text DEFAULT ''::text NOT NULL,
    complemento text DEFAULT ''::text NOT NULL,
    bairro text DEFAULT ''::text NOT NULL,
    cep text DEFAULT ''::text NOT NULL,
    contribuinte_nome text DEFAULT ''::text NOT NULL,
    contribuinte_doc text DEFAULT ''::text NOT NULL,
    contribuinte_email text DEFAULT ''::text NOT NULL,
    contribuinte_telefone text DEFAULT ''::text NOT NULL,
    matricula_cartorio text DEFAULT ''::text NOT NULL,
    cartorio text DEFAULT ''::text NOT NULL,
    area_terreno_m2 double precision,
    area_construida_m2 double precision,
    testada_m double precision,
    n_pavimentos integer,
    padrao_construtivo text DEFAULT 'medio'::text NOT NULL,
    ano_construcao integer,
    observacoes text DEFAULT ''::text NOT NULL,
    valor_venal_terreno numeric(14,2),
    valor_venal_construcao numeric(14,2),
    valor_venal_total numeric(14,2),
    pendencias jsonb DEFAULT '[]'::jsonb NOT NULL,
    tem_erro boolean DEFAULT true NOT NULL,
    sinter_status text DEFAULT 'pendente_correcao'::text NOT NULL,
    transmitido boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: imoveis_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.imoveis ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.imoveis_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: lotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lotes (
    id bigint NOT NULL,
    municipio text,
    codigo text,
    quadra text,
    bairro text,
    uso text,
    area_m2 double precision,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    geom public.geometry(MultiPolygon,4326)
);

--
-- Name: lotes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.lotes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.lotes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: municipio_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.municipio_config (
    municipio text NOT NULL,
    nome_oficial text DEFAULT ''::text NOT NULL,
    uf text DEFAULT 'PB'::text NOT NULL,
    codigo_ibge text DEFAULT ''::text NOT NULL,
    cnpj text DEFAULT ''::text NOT NULL,
    secretaria text DEFAULT 'Secretaria Municipal de Finanças'::text NOT NULL,
    setor text DEFAULT 'Setor de Cadastro Imobiliário'::text NOT NULL,
    endereco text DEFAULT ''::text NOT NULL,
    telefone text DEFAULT ''::text NOT NULL,
    email text DEFAULT ''::text NOT NULL,
    site text DEFAULT ''::text NOT NULL,
    prefeito_nome text DEFAULT ''::text NOT NULL,
    responsavel_nome text DEFAULT ''::text NOT NULL,
    responsavel_cargo text DEFAULT ''::text NOT NULL,
    convenio_numero text DEFAULT ''::text NOT NULL,
    convenio_data date,
    prazo_sinter date,
    transmissores text DEFAULT ''::text NOT NULL,
    validade_certidao_dias integer DEFAULT 90 NOT NULL,
    brasao text DEFAULT ''::text NOT NULL,
    rodape_documentos text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: ordens_servico; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ordens_servico (
    id text NOT NULL,
    numero text NOT NULL,
    tipo text,
    descricao text,
    endereco text,
    bairro text,
    referencia text,
    solicitante text NOT NULL,
    responsavel text,
    equipe text,
    prioridade text DEFAULT 'media'::text,
    prazo date,
    status text DEFAULT 'aberta'::text,
    ocorrencias integer DEFAULT 1,
    primeira_ocorrencia date,
    tag text DEFAULT ''::text,
    foto_abertura text,
    foto_conclusao text,
    historico jsonb DEFAULT '[]'::jsonb,
    criado_em timestamp with time zone DEFAULT now(),
    atualizado_em timestamp with time zone DEFAULT now(),
    concluido_em timestamp with time zone
);

--
-- Name: pgv_valores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pgv_valores (
    id bigint NOT NULL,
    municipio text DEFAULT ''::text NOT NULL,
    tipo text NOT NULL,
    chave text NOT NULL,
    valor_m2 numeric(12,2) DEFAULT 0 NOT NULL,
    ano integer DEFAULT 2026 NOT NULL
);

--
-- Name: pgv_valores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pgv_valores ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pgv_valores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: quadras; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quadras (
    id bigint NOT NULL,
    municipio text,
    codigo text,
    bairro text,
    area_m2 double precision,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    geom public.geometry(MultiPolygon,4326)
);

--
-- Name: quadras_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.quadras ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.quadras_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: requerimentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.requerimentos (
    id bigint NOT NULL,
    municipio text DEFAULT ''::text NOT NULL,
    numero text NOT NULL,
    tipo text NOT NULL,
    documento_tipo text DEFAULT ''::text NOT NULL,
    requerente_nome text NOT NULL,
    requerente_doc text DEFAULT ''::text NOT NULL,
    requerente_email text DEFAULT ''::text NOT NULL,
    requerente_telefone text DEFAULT ''::text NOT NULL,
    imovel_id bigint,
    inscricao text DEFAULT ''::text NOT NULL,
    descricao text DEFAULT ''::text NOT NULL,
    dados jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'protocolado'::text NOT NULL,
    prazo date,
    responsavel_nome text DEFAULT ''::text NOT NULL,
    parecer text DEFAULT ''::text NOT NULL,
    documento_id bigint,
    movimentacao_id bigint,
    demanda_id bigint,
    historico jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: requerimentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.requerimentos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.requerimentos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: ruas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ruas (
    id bigint NOT NULL,
    municipio text,
    codigo text,
    nome text,
    bairro text,
    pavimentada boolean,
    tipo_pavimento text,
    extensao_m double precision,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    geom public.geometry(MultiLineString,4326)
);

--
-- Name: ruas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ruas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ruas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios (
    id bigint NOT NULL,
    nome text NOT NULL,
    email text NOT NULL,
    senha_hash text NOT NULL,
    role text DEFAULT 'tecnico'::text NOT NULL,
    equipe text DEFAULT ''::text,
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.usuarios ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.usuarios_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: waze_buracos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waze_buracos (
    coordenadas text NOT NULL,
    data date NOT NULL,
    lat double precision,
    lon double precision,
    rua text,
    relatos integer DEFAULT 0,
    confirmacoes integer DEFAULT 0,
    score integer DEFAULT 0,
    sincronizado_em timestamp with time zone DEFAULT now()
);

--
-- Name: bairros bairros_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bairros
    ADD CONSTRAINT bairros_pkey PRIMARY KEY (id);

--
-- Name: bci_formulario bci_formulario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bci_formulario
    ADD CONSTRAINT bci_formulario_pkey PRIMARY KEY (id);

--
-- Name: bci_foto bci_foto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bci_foto
    ADD CONSTRAINT bci_foto_pkey PRIMARY KEY (id);

--
-- Name: bci bci_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bci
    ADD CONSTRAINT bci_pkey PRIMARY KEY (id);

--
-- Name: cib_auditoria cib_auditoria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cib_auditoria
    ADD CONSTRAINT cib_auditoria_pkey PRIMARY KEY (id);

--
-- Name: cib_divergencias cib_divergencias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cib_divergencias
    ADD CONSTRAINT cib_divergencias_pkey PRIMARY KEY (id);

--
-- Name: cib_implantacao cib_implantacao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cib_implantacao
    ADD CONSTRAINT cib_implantacao_pkey PRIMARY KEY (municipio);

--
-- Name: cib_movimentacoes cib_movimentacoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cib_movimentacoes
    ADD CONSTRAINT cib_movimentacoes_pkey PRIMARY KEY (id);

--
-- Name: cib_remessas cib_remessas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cib_remessas
    ADD CONSTRAINT cib_remessas_pkey PRIMARY KEY (id);

--
-- Name: cib_vistorias cib_vistorias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cib_vistorias
    ADD CONSTRAINT cib_vistorias_pkey PRIMARY KEY (id);

--
-- Name: demanda_responsaveis demanda_responsaveis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demanda_responsaveis
    ADD CONSTRAINT demanda_responsaveis_pkey PRIMARY KEY (demanda_id, usuario_id);

--
-- Name: demandas demandas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demandas
    ADD CONSTRAINT demandas_pkey PRIMARY KEY (id);

--
-- Name: documentos documentos_codigo_validacao_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_codigo_validacao_key UNIQUE (codigo_validacao);

--
-- Name: documentos documentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_pkey PRIMARY KEY (id);

--
-- Name: edificacoes edificacoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.edificacoes
    ADD CONSTRAINT edificacoes_pkey PRIMARY KEY (id);

--
-- Name: imoveis imoveis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imoveis
    ADD CONSTRAINT imoveis_pkey PRIMARY KEY (id);

--
-- Name: lotes lotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes
    ADD CONSTRAINT lotes_pkey PRIMARY KEY (id);

--
-- Name: municipio_config municipio_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.municipio_config
    ADD CONSTRAINT municipio_config_pkey PRIMARY KEY (municipio);

--
-- Name: ordens_servico ordens_servico_numero_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordens_servico
    ADD CONSTRAINT ordens_servico_numero_key UNIQUE (numero);

--
-- Name: ordens_servico ordens_servico_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordens_servico
    ADD CONSTRAINT ordens_servico_pkey PRIMARY KEY (id);

--
-- Name: pgv_valores pgv_valores_municipio_tipo_chave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgv_valores
    ADD CONSTRAINT pgv_valores_municipio_tipo_chave_key UNIQUE (municipio, tipo, chave);

--
-- Name: pgv_valores pgv_valores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgv_valores
    ADD CONSTRAINT pgv_valores_pkey PRIMARY KEY (id);

--
-- Name: quadras quadras_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quadras
    ADD CONSTRAINT quadras_pkey PRIMARY KEY (id);

--
-- Name: requerimentos requerimentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requerimentos
    ADD CONSTRAINT requerimentos_pkey PRIMARY KEY (id);

--
-- Name: ruas ruas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ruas
    ADD CONSTRAINT ruas_pkey PRIMARY KEY (id);

--
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);

--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);

--
-- Name: waze_buracos waze_buracos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waze_buracos
    ADD CONSTRAINT waze_buracos_pkey PRIMARY KEY (coordenadas, data);

--
-- Name: idx_aud_muni; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aud_muni ON public.cib_auditoria USING btree (municipio, created_at DESC);

--
-- Name: idx_bairros_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bairros_geom ON public.bairros USING gist (geom);

--
-- Name: idx_bairros_municipio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bairros_municipio ON public.bairros USING btree (municipio);

--
-- Name: idx_bci_ajuste; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bci_ajuste ON public.bci USING btree (ajuste_geom) WHERE (ajuste_geom = true);

--
-- Name: idx_bci_municipio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bci_municipio ON public.bci USING btree (municipio);

--
-- Name: idx_bci_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bci_status ON public.bci USING btree (status);

--
-- Name: idx_demandas_prazo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demandas_prazo ON public.demandas USING btree (prazo);

--
-- Name: idx_demandas_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demandas_status ON public.demandas USING btree (status);

--
-- Name: idx_demresp_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demresp_usuario ON public.demanda_responsaveis USING btree (usuario_id);

--
-- Name: idx_div_imovel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_div_imovel ON public.cib_divergencias USING btree (imovel_id);

--
-- Name: idx_div_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_div_status ON public.cib_divergencias USING btree (municipio, status);

--
-- Name: idx_doc_imovel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_imovel ON public.documentos USING btree (imovel_id);

--
-- Name: idx_doc_muni; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_muni ON public.documentos USING btree (municipio, emitido_em DESC);

--
-- Name: idx_edificacoes_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_edificacoes_geom ON public.edificacoes USING gist (geom);

--
-- Name: idx_edificacoes_municipio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_edificacoes_municipio ON public.edificacoes USING btree (municipio);

--
-- Name: idx_imoveis_cib; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imoveis_cib ON public.imoveis USING btree (cib) WHERE (cib <> ''::text);

--
-- Name: idx_imoveis_lote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imoveis_lote ON public.imoveis USING btree (lote_id);

--
-- Name: idx_imoveis_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_imoveis_status ON public.imoveis USING btree (municipio, sinter_status);

--
-- Name: idx_lotes_bairro; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lotes_bairro ON public.lotes USING btree (bairro);

--
-- Name: idx_lotes_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lotes_geom ON public.lotes USING gist (geom);

--
-- Name: idx_lotes_municipio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lotes_municipio ON public.lotes USING btree (municipio);

--
-- Name: idx_mov_imovel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mov_imovel ON public.cib_movimentacoes USING btree (imovel_id);

--
-- Name: idx_mov_muni_comp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mov_muni_comp ON public.cib_movimentacoes USING btree (municipio, competencia);

--
-- Name: idx_mov_remessa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mov_remessa ON public.cib_movimentacoes USING btree (remessa_id);

--
-- Name: idx_mov_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mov_status ON public.cib_movimentacoes USING btree (municipio, status);

--
-- Name: idx_os_criado_em; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_criado_em ON public.ordens_servico USING btree (criado_em DESC);

--
-- Name: idx_os_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_status ON public.ordens_servico USING btree (status);

--
-- Name: idx_quadras_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quadras_geom ON public.quadras USING gist (geom);

--
-- Name: idx_quadras_municipio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quadras_municipio ON public.quadras USING btree (municipio);

--
-- Name: idx_req_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_req_status ON public.requerimentos USING btree (municipio, status);

--
-- Name: idx_ruas_bairro; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ruas_bairro ON public.ruas USING btree (bairro);

--
-- Name: idx_ruas_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ruas_geom ON public.ruas USING gist (geom);

--
-- Name: idx_ruas_municipio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ruas_municipio ON public.ruas USING btree (municipio);

--
-- Name: idx_ruas_pav; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ruas_pav ON public.ruas USING btree (pavimentada);

--
-- Name: idx_vist_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vist_status ON public.cib_vistorias USING btree (municipio, status);

--
-- Name: idx_waze_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waze_data ON public.waze_buracos USING btree (data DESC);

--
-- Name: uq_bci_aberto_lote; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bci_aberto_lote ON public.bci USING btree (lote_id) WHERE ((lote_id IS NOT NULL) AND (status = ANY (ARRAY['rascunho'::text, 'enviado'::text])));

--
-- Name: uq_doc_numero; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_doc_numero ON public.documentos USING btree (municipio, tipo, ano, seq);

--
-- Name: uq_imoveis_insc; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_imoveis_insc ON public.imoveis USING btree (municipio, inscricao);

--
-- Name: uq_remessa_num; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_remessa_num ON public.cib_remessas USING btree (municipio, numero);

--
-- Name: uq_req_numero; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_req_numero ON public.requerimentos USING btree (municipio, numero);

--
-- Name: bci_foto bci_foto_bci_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bci_foto
    ADD CONSTRAINT bci_foto_bci_id_fkey FOREIGN KEY (bci_id) REFERENCES public.bci(id) ON DELETE CASCADE;

--
-- Name: bci bci_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bci
    ADD CONSTRAINT bci_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes(id) ON DELETE SET NULL;

--
-- Name: cib_divergencias cib_divergencias_imovel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cib_divergencias
    ADD CONSTRAINT cib_divergencias_imovel_id_fkey FOREIGN KEY (imovel_id) REFERENCES public.imoveis(id) ON DELETE CASCADE;

--
-- Name: cib_divergencias cib_divergencias_movimentacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cib_divergencias
    ADD CONSTRAINT cib_divergencias_movimentacao_id_fkey FOREIGN KEY (movimentacao_id) REFERENCES public.cib_movimentacoes(id) ON DELETE SET NULL;

--
-- Name: cib_divergencias cib_divergencias_remessa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cib_divergencias
    ADD CONSTRAINT cib_divergencias_remessa_id_fkey FOREIGN KEY (remessa_id) REFERENCES public.cib_remessas(id) ON DELETE SET NULL;

--
-- Name: cib_movimentacoes cib_movimentacoes_imovel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cib_movimentacoes
    ADD CONSTRAINT cib_movimentacoes_imovel_id_fkey FOREIGN KEY (imovel_id) REFERENCES public.imoveis(id) ON DELETE SET NULL;

--
-- Name: cib_movimentacoes cib_movimentacoes_remessa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cib_movimentacoes
    ADD CONSTRAINT cib_movimentacoes_remessa_id_fkey FOREIGN KEY (remessa_id) REFERENCES public.cib_remessas(id) ON DELETE SET NULL;

--
-- Name: cib_vistorias cib_vistorias_imovel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cib_vistorias
    ADD CONSTRAINT cib_vistorias_imovel_id_fkey FOREIGN KEY (imovel_id) REFERENCES public.imoveis(id) ON DELETE SET NULL;

--
-- Name: cib_vistorias cib_vistorias_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cib_vistorias
    ADD CONSTRAINT cib_vistorias_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes(id) ON DELETE CASCADE;

--
-- Name: demanda_responsaveis demanda_responsaveis_demanda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demanda_responsaveis
    ADD CONSTRAINT demanda_responsaveis_demanda_id_fkey FOREIGN KEY (demanda_id) REFERENCES public.demandas(id) ON DELETE CASCADE;

--
-- Name: documentos documentos_imovel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_imovel_id_fkey FOREIGN KEY (imovel_id) REFERENCES public.imoveis(id) ON DELETE SET NULL;

--
-- Name: documentos documentos_requerimento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_requerimento_id_fkey FOREIGN KEY (requerimento_id) REFERENCES public.requerimentos(id) ON DELETE SET NULL;

--
-- Name: imoveis imoveis_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imoveis
    ADD CONSTRAINT imoveis_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes(id) ON DELETE SET NULL;

--
-- Name: requerimentos requerimentos_imovel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requerimentos
    ADD CONSTRAINT requerimentos_imovel_id_fkey FOREIGN KEY (imovel_id) REFERENCES public.imoveis(id) ON DELETE SET NULL;

--
-- PostgreSQL database dump complete
--
