# Imagem Node enxuta (Render injeta a porta via variavel PORT).
FROM node:22-alpine

WORKDIR /app

# Instala as dependencias primeiro (aproveita cache de camadas).
COPY package*.json ./
RUN npm ci --omit=dev

# Copia o restante do codigo (front, API, migrations, scripts).
COPY . .

# NODE_ENV NAO e fixado aqui: cada servico define o seu no Render.
#  - vitrine/demonstracao (portifoliobzr.onrender.com): NODE_ENV=demo (ou vazio),
#    pode usar SEED_*_DEMO e CIB_SIMULAR_RETORNO;
#  - prefeitura com dados reais: NODE_ENV=production — o boot FALHA sem login,
#    AUTH_SECRET forte, MUNICIPIO e PUBLIC_BASE_URL (src/env.js, docs/operacao.md).
# Documental: o Render fornece a porta real via $PORT; o server usa process.env.PORT.
EXPOSE 3000

# Sobe o servidor: aplica as migrations pendentes no boot e, fora de producao,
# carrega as demonstracoes ligadas (SEED_*_DEMO=true).
CMD ["npm", "start"]
