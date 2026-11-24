# Dashboard Faturação (Sensilis / Wells) — sem Power BI

Site estático + 2 pequenas funções (`/api/data`, `/api/import`) para o Vercel.
Lê os Excel mensais diretamente no browser, guarda os dados por mês e mostra o dashboard (TOTAL / LOJAS / ONLINE).

## Publicar no Vercel (1 vez, ~10 min)

1. **Código no Vercel**: ou `npm i -g vercel` e, dentro desta pasta, `vercel` (e `vercel --prod`);
   ou põe a pasta num repositório GitHub e em vercel.com → *Add New → Project* importa-o.
   (Framework: *Other*. Não é preciso build.)
2. **Base de dados grátis**: no projeto, separador *Storage* → *Marketplace* → **Upstash Redis** → criar → ligar ao projeto.
   Isto cria sozinho as variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN`.
3. **Palavra-passe de importação**: *Settings → Environment Variables* → criar `ADMIN_PASSWORD` com a palavra-passe que quiseres.
4. **Redeploy** (Deployments → ⋯ → Redeploy) para as variáveis entrarem em vigor.
5. Abre o site → **Importar dados** → seleciona **todos** os Excel da pasta `Dados` de uma vez → palavra-passe → Importar.
   (O ficheiro `08 (1).xlsx` tem 2025 e 2026 juntos; o site separa por mês sozinho.)

## Todos os meses (30 segundos)

Site → **Importar dados** → escolhe o Excel do mês novo → confere a pré-visualização → palavra-passe → **Importar**.
- Mês novo aparece como "novo"; se repetires um mês, aparece "substitui" e o antigo é trocado (não há duplicados).
- Podes largar vários ficheiros de uma vez. Em "Meses já carregados" podes eliminar um mês errado.
- O Excel tem de ter as colunas: Data (MM/AAAA), LojaEntreposto, CodArtigo, DscArtigo, TipoArtigo, Marca, Quant, Valor (Categoria opcional).

## Testar no teu computador (opcional)

`node servidor-local.js` → http://localhost:3000 (palavra-passe local: `wells`; dados em `dados-locais/`).
Sem servidor/base de dados, o site funciona em **modo local** (dados só no browser de quem importa).

## Como são calculados os indicadores

- Ano selecionado (Y) vs ano anterior (Y-1), **no mesmo período**: meses escolhidos, ou jan → último mês com dados de Y.
- YtD = Fat. Y − Fat. Y-1 ; %YtD = Fat. Y / Fat. Y-1 − 1.
- ONLINE = loja "WELLS ONLINE"; LOJAS = todas as outras; TOTAL = tudo.
- "Loja" = código L####, com o nome mais recente.

## Atenção

- Quem tiver o link vê os dados (a palavra-passe só protege a importação). Para restringir a leitura, ativa a *Deployment Protection* do Vercel.
