# IA_LOG — Auditoria e Registro de Uso de Inteligência Artificial

Este arquivo atende ao requisito de **Auditoria (`IA_LOG.md`)** do projeto **Smart-Base Helpdesk**, documentando na íntegra os **prompts utilizados** durante cada fase do desenvolvimento, **o que a IA respondeu/gerou** e **todas as adaptações e intervenções manuais realizadas pelo autor** (validando o fluxo de ponta a ponta desde `docker-compose up -d`, `npx prisma migrate dev` e `node src/seed.js`).

---

## Sumário

1. [Tabela Resumo de Auditoria (Fases, Prompts, Respostas e Adaptações)](#1-tabela-resumo-de-auditoria-fases-prompts-respostas-e-adaptações)
2. [Auditoria Detalhada: Prompts na Íntegra e Adaptações Manuais por Fase](#2-auditoria-detalhada-prompts-na-íntegra-e-adaptações-manuais-por-fase)
   - [Fase 0 — Infraestrutura Docker, `pgvector` e Embeddings Gemini](#fase-0--infraestrutura-docker-pgvector-e-embeddings-gemini)
   - [Fase 1 (Parte 1) — Ajustar Modelagem Prisma (`Documentos` + `pgvector`)](#fase-1-parte-1--ajustar-modelagem-prisma-documentos--pgvector)
   - [Fase 1 (Parte 2) — Enriquecer Modelagem Prisma com Relacionamentos Complexos e Prisma 7](#fase-1-parte-2--enriquecer-modelagem-prisma-com-relacionamentos-complexos-e-prisma-7)
   - [Fase 2 — Estrutura do Código em Camadas (`src/`) e Migração para TypeScript](#fase-2--estrutura-do-código-em-camadas-src-e-migração-para-typescript)
   - [Fase 3 — Seed Idempotente de 5.000 Chamados (`node src/seed.js`)](#fase-3--seed-idempotente-de-5000-chamados-node-srcseedjs)
   - [Fase 4 — API REST (Express + Zod), Transações ACID e Tratamento de Erros](#fase-4--api-rest-express--zod-transações-acid-e-tratamento-de-erros)
   - [Fase 5 & 6 — Recuperação Inteligente (RAG) e Busca Full-Text (Elasticsearch)](#fase-5--6--recuperação-inteligente-rag-e-busca-full-text-elasticsearch)
   - [Fase 7 — Desempenho nas Consultas (`EXPLAIN ANALYZE`, Índices Compostos/GIN e Benchmark)](#fase-7--desempenho-nas-consultas-explain-analyze-índices-compostosgin-e-benchmark)
3. [Verificação do Fluxo de Auditoria (`docker-compose up -d` → `npx prisma migrate` → `node src/seed.js`)](#3-verificação-do-fluxo-de-auditoria-docker-compose-up--d--npx-prisma-migrate--node-srcseedjs)

---

## 1. Tabela Resumo de Auditoria (Fases, Prompts, Respostas e Adaptações)

| # | Data | Autor | Fase / Escopo | Resumo do Prompt | O que a IA Respondeu | O que Foi Adaptado Manualmente |
|---|---|---|---|---|---|---|
| **1** | `2026-11-05` | `Nizo0UZ` (Lucas) | **Fase 0 — Docker, `pgvector` e Embeddings** | Configurar `docker-compose.yml` (`pgvector:pg16`, pgAdmin, Elasticsearch), migration da tabela `Documentos` com índice HNSW e script de embeddings Gemini. | Sugeriu `@google/generative-ai` com modelo `text-embedding-004` (768 dims) e SQL inicial da tabela `Documentos`. | 1. **Troca de `text-embedding-004` por `gemini-embedding-001` (`1536` dimensões)** na nova SDK `@google/genai` com `outputDimensionality: 1536` e `taskType` (`RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`).<br>2. **Ajuste manual do SQL da migration (`20261106004222_add_pgvector_documentos`)**: coluna `VECTOR(1536)` e criação do índice `documentos_embedding_hnsw_idx` (`USING hnsw (embedding vector_cosine_ops)`). |
| **2** | `2026-11-08` | `Nizo0UZ` (Lucas) | **Fase 1.1 — Ajustar Modelagem Prisma (`Documentos` + FK)** | Trazer `Documentos` para o `schema.prisma` com `Unsupported("vector(1536)")`, FKs opcionais `chamadoId`/`artigoId` e declarar extensão `vector` no `datasource`. | Entregou o bloco `datasource` com `extensions = [vector]`, o modelo `Documentos` com FKs `SetNull` e a migration `20261108213939_documentos_fk_chamado_artigo`. | **Identificação de *drift* no índice HNSW:** o Prisma gerou `DROP INDEX "documentos_embedding_hnsw_idx";` na migration `20261108213939` por não suportar `type: Hnsw` em colunas `Unsupported`. Isso motivou a intervenção manual na migration seguinte sem violar o histórico versionado. |
| **3** | `2026-11-08` | `Nizo0UZ` (Lucas) | **Fase 1.2 — Enriquecer Modelagem Prisma e Prisma 7** | Adicionar `Comentario` (1:N), `Tag`/`ChamadoTag` (N:N explícita), `Artigo` (1:N com `Usuario` e `Categoria`), `solucao`/`resolvidoEm` em `Chamado`, `onDelete` explícito, preservar HNSW e migrar para o padrão Prisma 7. | Gerou o schema completo com 8 tabelas, justificativas de `onDelete`, configuração `prisma-client` + `@prisma/adapter-pg` e script `scripts/teste-prisma.ts`. | 1. **Edição manual da migration (`--create-only`):** foi adicionado manualmente `CREATE INDEX IF NOT EXISTS documentos_embedding_hnsw_idx ...` ao final de `20261108214949_comentarios_tags_artigo_autor_categoria_solucao/migration.sql` e aplicado com `migrate deploy`.<br>2. **Configuração de `moduleFormat = "cjs"`** no gerador do Prisma 7 para compatibilidade entre TypeScript (`tsx`) e scripts `.js`. |
| **4** | `2026-11-08` | `Nizo0UZ` (Lucas) | **Fase 2 — Estrutura `src/` e Migração para TypeScript** | Reorganizar `backend/` em `src/{config,services,routes,middlewares}`, migrar `embeddings.js` para `embeddingService.ts`, criar singleton `prisma.ts` e converter tudo para TypeScript estrito. | Criou toda a árvore `src/`, centralizou `env.ts`, `prisma.ts`, `pg.ts`, `gemini.ts` e `elastic.ts`, tipou serviços/rotas sem `any` e configurou `tsconfig.json` e `package.json`. | Ajuste nos caminhos de importação do cliente gerado (`../../generated/prisma/client`), remoção de instâncias duplicadas de `PrismaClient` e criação de wrappers CommonJS (`seed.js`, `benchmark.js`) para suportar execução direta via `node`. |
| **5** | `2026-11-08` | `Nizo0UZ` (Lucas) | **Fase 3 — Seed de 5.000 Chamados (`node src/seed.js`)** | Criar seeder idempotente com `@faker-js/faker` (`pt_BR`), `bcrypt`, 10 categorias, 50 usuários, 20 artigos, 5.000 chamados (40 realistas de TI escritos à mão + 4.960 sintéticos) e indexação de embeddings em lotes. | Implementou `src/seed.ts` com inserções em lote (`createMany` em `prisma.$transaction`) e indexação semântica com `batchEmbedContents`. | 1. **Proteção de Rate-Limit da cota gratuita Gemini:** restringi a geração de embeddings via API durante o seed aos **40 chamados realistas** + **20 artigos** (lotes de 20 com delay de `1.500 ms`).<br>2. **Reinício de sequências (`ALTER SEQUENCE ... RESTART WITH 1`) e sincronização automática com Elasticsearch** ao final do `node src/seed.js`. |
| **6** | `2026-11-08` | `Nizo0UZ` (Lucas) | **Fase 4 — API REST (Express + Zod) e Transações** | Implementar rotas REST obrigatórias com validação `zod`, transações `prisma.$transaction` (resolver chamado = status + solução + comentário + reindexar), regras de negócio (`ATENDENTE`, `FECHADO`) e middleware de erros (`P2002`→`409`, `P2003`→`400`). | Implementou rotas (`categorias`, `usuarios`, `chamados`, `artigos`), `chamadoService.ts`, `erros.ts`, `validacao.ts` e suíte de testes automatizados (`src/chamados.test.ts`). | Refinamento do tratamento transacional: garantia de rollback completo nas regras de negócio e tratamento resiliente na indexação externa para não corromper dados em caso de timeout de rede. |
| **7** | `2026-11-08` | `Nizo0UZ` (Lucas) | **Fase 5 & 6 — RAG (`pgvector` + Gemini) e Elasticsearch** | Implementar `GET /busca/semantica`, `POST /rag/perguntar` (resposta gerada com citação de IDs), índice `chamados` no Elasticsearch com analisador `brazilian`, sincronização `bulk` e `GET /busca/texto` + `/busca/comparar`. | Criou `ragService.ts`, `buscaService.ts`, `scripts/sincronizar-elastic.ts` e as rotas `/busca/*` e `/rag/perguntar`. | 1. **Fallback automático de modelos Gemini (`gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-2.0-flash-lite`)** em `ragService.ts`.<br>2. **Prompt restritivo anti-alucinação** exigindo citações no formato `[Chamado #id]` e `[Artigo #id]`. |
| **8** | `2026-11-08` | `Nizo0UZ` (Lucas) | **Fase 7 — Desempenho (`EXPLAIN ANALYZE` e Benchmark 5.000+)** | Rodar `EXPLAIN ANALYZE` comprovando uso de índices (`B-tree`, composto `[status, categoriaId]`, `GIN` full-text e `HNSW`), medir `ILIKE` × `pgvector` × `Elasticsearch` em 5.000+ registros e registrar no `README.md`. | Criou a migration `20261108221000_indice_composto_status_categoria_fts_gin`, o script `scripts/benchmark.ts` (`.js`) e a documentação de performance. | 1. **Reescrita da query vetorial com subquery `top_docs`:** isolei o `ORDER BY embedding <=> $1 LIMIT K` antes dos `LEFT JOIN` para baixar o custo estimado pelo planner de `~952` para `524.65` (abaixo dos `628.23` do `Seq Scan`), reduzindo a execução de `41.87 ms` para **`0.916 ms`** (**45,7x mais rápido**).<br>2. **Cache de `pgvector.registerTypes` via `WeakSet<PoolClient>`** em `src/config/pg.ts`. |

---

## 2. Auditoria Detalhada: Prompts na Íntegra e Adaptações Manuais por Fase

Abaixo estão registrados os prompts exatos utilizados pelo autor (conforme arquivo [`backend/prompts.md`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/prompts.md) e sessões de desenvolvimento) seguidos da análise crítica e das adaptações manuais realizadas.

---

### Fase 0 — Infraestrutura Docker, `pgvector` e Embeddings Gemini

- **Data:** `2026-11-05`
- **Autor:** `Nizo0UZ` (Lucas)
- **Prompt utilizado:**
  > *"Crie um ambiente `docker-compose.yml` com PostgreSQL 16 (imagem com `pgvector`), pgAdmin 4 e Elasticsearch. Crie também uma migration SQL para habilitar a extensão `vector`, criar a tabela `Documentos` com coluna de embedding e índice HNSW para busca por similaridade de cosseno, além de um script em Node.js que gere embeddings com a API do Google Gemini e consulte os documentos mais similares."*

- **O que a IA respondeu:**
  - Gerou o `docker-compose.yml` com os 3 serviços e volumes persistentes.
  - Sugeriu inicialmente um script de embeddings baseado na biblioteca antiga `@google/generative-ai` usando o modelo `text-embedding-004` (768 dimensões).

- **Adaptações manuais realizadas:**
  1. **Troca do modelo `text-embedding-004` por `gemini-embedding-001` com `1536` dimensões:**
     - O modelo `text-embedding-004` sugerido inicialmente pela IA não estava mais disponível na versão atual da API Gemini.
     - Realizei a migração para a nova SDK oficial `@google/genai` (`GoogleGenAI`) utilizando o modelo **`gemini-embedding-001`** configurado explicitamente com `outputDimensionality: 1536` e `taskType: 'RETRIEVAL_DOCUMENT'` (para indexação) / `'RETRIEVAL_QUERY'` (para busca).
  2. **Ajuste manual do DDL na migration [`20261106004222_add_pgvector_documentos/migration.sql`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/prisma/migrations/20261106004222_add_pgvector_documentos/migration.sql):**
     - Ajustei a definição da coluna para `embedding VECTOR(1536) NOT NULL` e configurei o índice HNSW com `m = 16` e `ef_construction = 64`:
       ```sql
       CREATE EXTENSION IF NOT EXISTS vector;

       CREATE INDEX IF NOT EXISTS documentos_embedding_hnsw_idx
           ON "Documentos"
           USING hnsw (embedding vector_cosine_ops)
           WITH (m = 16, ef_construction = 64);
       ```

---

### Fase 1 (Parte 1) — Ajustar Modelagem Prisma (`Documentos` + `pgvector`)

- **Data:** `2026-11-08`
- **Autor:** `Nizo0UZ` (Lucas)
- **Prompt utilizado (na íntegra — ver [`backend/prompts.md`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/prompts.md#L1-L17)):**
  ```markdown
  Você é um engenheiro de backend sênior com experiência em Prisma ORM, PostgreSQL e extensão pgvector, trabalhando em um projeto Node/TypeScript existente. Preciso que você faça a Fase 1 da migração de modelagem (Trilha A) no arquivo `schema.prisma` do meu projeto, sem alterar nada além do necessário para essa fase.

  O objetivo é que o modelo `Documentos` passe a armazenar embeddings vetoriais de 1536 dimensões ligados ao registro relacional correspondente, de forma que o vetor fique rastreável a um chamado ou a um artigo.

  Requisitos que devem ser atendidos:

  1. No modelo `Documentos`, adicionar a coluna `embedding` do tipo `Unsupported("vector(1536)")`, para que o Prisma reconheça a coluna sem tentar interpretá-la como tipo nativo.
  2. Adicionar as colunas `chamadoId` e `artigoId` como opcionais (nullable), cada uma com relação e chave estrangeira (FK) apontando para os modelos `Chamado` e `Artigo` respectivamente, usando os nomes de campo e de modelo já existentes no meu schema. Se algum desses modelos não existir com esse nome, mantenha a convenção de nomes do restante do arquivo e sinalize a divergência no seu resumo final.
  3. Declarar a extensão `vector` no bloco `datasource`. Use `previewFeatures = ["postgresqlExtensions"]` junto com `extensions = [vector]` quando a versão do Prisma exigir (Prisma 5.x e superiores com a feature habilitada) e verifique a versão em `package.json` antes de escolher a sintaxe. A finalidade é impedir que o Prisma tente remover a extensão durante `migrate`.
  4. Não criar ainda índices vetoriais (HNSW/IVFFlat), não alterar outros modelos e não gerar migrations destrutivas. Se for necessário um índice de FK, pode incluí-lo, mas informe isso explicitamente.

  Entregue: o bloco `datasource` e o modelo `Documentos` completos e prontos para colar, o comando de migration recomendado (por exemplo `npx prisma migrate dev --name ...`), e uma lista curta do que foi alterado, com qualquer suposição feita sobre nomes de modelos ou versão do Prisma.

  Caso eu tenha colado trechos atuais do `schema.prisma` ou do `package.json`, use-os como base e preserve tudo que não faz parte desta fase.
  ```

- **O que a IA respondeu:**
  - Adicionou `previewFeatures = ["postgresqlExtensions"]` no `generator client` e `extensions = [vector]` no `datasource db`.
  - Criou o modelo `Artigo` básico e trouxe `Documentos` para o `schema.prisma` com `embedding Unsupported("vector(1536)")` e FKs opcionais `chamadoId` e `artigoId` (`onDelete: SetNull`).
  - Gerou a migration [`20261108213939_documentos_fk_chamado_artigo/migration.sql`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/prisma/migrations/20261108213939_documentos_fk_chamado_artigo/migration.sql).

- **Adaptações manuais realizadas:**
  - Ao inspecionar o SQL gerado pelo Prisma na migration `20261108213939_documentos_fk_chamado_artigo`, identifiquei que a primeira linha gerada pelo Prisma Migrate foi:
    ```sql
    -- DropIndex
    DROP INDEX "documentos_embedding_hnsw_idx";
    ```
  - Isso ocorreu porque o índice HNSW havia sido criado manualmente na migration anterior (`20261106004222`), mas não podia ser declarado no `schema.prisma` (o Prisma 7 rejeita `@@index([embedding], type: Hnsw)` em colunas `Unsupported`). Tratei esse ponto na migration imediatamente seguinte (Fase 1 — Parte 2) para restaurar e blindar o índice HNSW sem reescrever migrations já commitadas.

---

### Fase 1 (Parte 2) — Enriquecer Modelagem Prisma com Relacionamentos Complexos e Prisma 7

- **Data:** `2026-11-08`
- **Autor:** `Nizo0UZ` (Lucas)
- **Prompt utilizado (na íntegra — ver [`backend/prompts.md`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/prompts.md#L19-L49)):**
  ```markdown
  # Prompt: Enriquecer a modelagem Prisma do sistema de chamados com relacionamentos complexos

  Eu tenho um sistema de chamados (helpdesk/service desk) em TypeScript com Prisma. Preciso que você enriqueça o schema para demonstrar relacionamentos complexos, gere a migration e valide a integração com o Prisma 7. Trabalhe no código real do projeto, sem reescrever módulos que não fazem parte desta mudança.

  **Objetivo:** ao final, o schema deve conter Comentario, Tag, ChamadoTag, Artigo e os novos campos de solução em Chamado, todos com relações e `onDelete` explícitos, e a migration aplicada com SQL conferido.

  **Modelagem pedida:**
  - **Comentario** (1:N com Chamado e com Usuario): registra o histórico de atendimento do chamado. Cada comentário pertence a um chamado e a um autor.
  - **Tag** e **ChamadoTag** (N:N entre Chamado e Tag, usando tabela de junção explícita).
  - **Artigo** (base de conhecimento) com título, conteúdo longo em texto, autor (Usuario) e categoria. Categoria deve ser modelada como entidade própria, não como string solta.
  - **Chamado**: adicionar `solucao` (texto, opcional) e `resolvidoEm` (data/hora, opcional).
  - **`onDelete` explícito em todas as relações novas e nas existentes que eu tocar**, com a escolha justificada pelo comportamento de negócio (ex.: apagar um chamado não deve apagar artigos; apagar um usuário autor de comentários precisa de decisão consciente).

  **Migration e índice vetorial:**
  - Rode `npx prisma migrate dev --name <nome-descritivo>`.
  - Confira o SQL gerado. O índice HNSW existente precisa continuar presente na migration final. Se o Prisma não o gerar ou tentar removê-lo, use `--create-only`, edite o SQL à mão para preservar o índice HNSW, e então aplique a migration.
  - Registre no IA_LOG se foi necessário editar o SQL manualmente, qual era o problema e como foi resolvido.

  **Prisma 7:**
  - Verifique a configuração atual de gerador e conexão. No Prisma 7 o padrão é o gerador `prisma-client` com a opção `output`, e a conexão ao banco é feita via driver adapter (`@prisma/adapter-pg`). Se o projeto usa `prisma-client-js`, avalie a migração para o padrão novo e explique o impacto no código de importação do client.
  - Crie um script simples (ex.: `scripts/teste-prisma.ts`) que faça um `findMany` em uma das entidades existentes e confirme que o client conecta e retorna dados. Execute-o e reporte o resultado.

  **Entregáveis esperados:**
  1. Schema Prisma atualizado, com comentários explicando decisões de `onDelete` e de cardinalidade.
  2. Migration gerada, com o SQL revisado e o HNSW preservado.
  3. Ajustes necessários no gerador/adaptador para Prisma 7, com o `findMany` de teste funcionando.
  4. Entrada no IA_LOG cobrindo migration, edição manual de SQL (se houver) e configuração do Prisma 7.

  Não adicione funcionalidades de API, interface ou regras de negócio além do que está descrito. Se algum ponto da modelagem conflitar com o código existente, aponte o conflito e escolha a alternativa mais conservadora para não quebrar o que já funciona.
  ```

- **O que a IA respondeu:**
  - Atualizou [`backend/prisma/schema.prisma`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/prisma/schema.prisma) com `Comentario`, `Tag`, `ChamadoTag`, `Artigo` (com `autorId` e `categoriaId`) e os campos `solucao` e `resolvidoEm` em `Chamado`, documentando cada política `onDelete` (`Restrict`, `Cascade`, `SetNull`).
  - Atualizou o gerador para o padrão do Prisma 7 (`provider = "prisma-client"`, `output = "../generated/prisma"`, `moduleFormat = "cjs"`) e configurou a conexão via `@prisma/adapter-pg` (`PrismaPg`).
  - Criou e executou `scripts/teste-prisma.ts` validando `findMany` e `$transaction`.

- **Adaptações manuais realizadas:**
  1. **Fluxo `--create-only` + Edição manual do SQL + `migrate deploy`:**
     - Gerei a migration [`20261108214949_comentarios_tags_artigo_autor_categoria_solucao/migration.sql`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/prisma/migrations/20261108214949_comentarios_tags_artigo_autor_categoria_solucao/migration.sql) com `npx prisma migrate dev --create-only`.
     - Adicionei manualmente ao final do arquivo SQL a recriação idempotente do índice HNSW:
       ```sql
       CREATE INDEX IF NOT EXISTS documentos_embedding_hnsw_idx
           ON "Documentos"
           USING hnsw (embedding vector_cosine_ops)
           WITH (m = 16, ef_construction = 64);
       ```
     - Apliquei a migration com `npx prisma migrate deploy` para evitar que um novo diff automático do `migrate dev` gerasse outro `DROP INDEX`.

---

### Fase 2 — Estrutura do Código em Camadas (`src/`) e Migração para TypeScript

- **Data:** `2026-11-08`
- **Autor:** `Nizo0UZ` (Lucas)
- **Prompt utilizado (na íntegra — ver [`backend/prompts.md`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/prompts.md#L52-L91)):**
  ```markdown
  Você é um engenheiro de software sênior, especialista em Node.js, TypeScript, Prisma, PostgreSQL, Elasticsearch e integração com a API do Gemini, responsável por reorganizar a estrutura de um backend existente e migrá-lo para TypeScript.

  Preciso que você reestruture o backend localizado em `backend/` para o padrão abaixo, convertendo todo o código para TypeScript. O objetivo é deixar o projeto organizado em camadas claras (config, services, routes, middlewares), com um único Prisma Client compartilhado, sem alterar o comportamento funcional da aplicação.

  Estrutura-alvo:

  backend/
    src/
      config/        (prisma client, pg pool, gemini, elastic)
      services/      (chamadoService, embeddingService, ragService, buscaService)
      routes/        (chamados, artigos, categorias, usuarios, busca)
      middlewares/   (erros, validação)
      server.ts
      seed.ts
    scripts/         (utilitários avulsos)

  Requisitos obrigatórios:

  - Mover a lógica de `backend/scripts/embeddings.js` para `src/services/embeddingService.ts`. Preserve a lógica de geração de embeddings e a integração existente; apenas ajuste a localização, imports e tipagem.
  - Criar um único Prisma Client compartilhado em `src/config/prisma.ts`, e fazer todos os serviços e rotas importarem dele, eliminando qualquer outra instância de `new PrismaClient()`.
  - Converter todos os arquivos `.js` do backend para `.ts`, com tipagens explícitas nas funções públicas, nos retornos de serviços e nos payloads de requisição/resposta. Evite `any`; quando for inevitável, justifique em comentário curto.
  - Adicionar ao `package.json` os scripts: `dev` (execução com recarregamento, ex.: tsx watch), `start` (execução do build compilado), `seed` (executa `src/seed.ts`), `migrate` (Prisma migrate) e `studio` (Prisma Studio), e `reindex` (reindexação de embeddings/Elasticsearch, usando a lógica movida para `embeddingService`). Ajuste também um script de build (`tsc`) necessário para o `start`.
  - Configurar `tsconfig.json` adequado ao Node.js, com `outDir` apontando para um diretório de build e `strict` habilitado.
  - Manter as dependências existentes (Prisma, pg pool, cliente Gemini, Elasticsearch) e instalar apenas os tipos e ferramentas estritamente necessários (ex.: `typescript`, `tsx`, `@types/node`, e tipos das bibliotecas usadas).
  - Manter o comportamento de todas as rotas (`chamados`, `artigos`, `categorias`, `usuarios`, `busca`) e dos serviços (`chamadoService`, `ragService`, `buscaService`) idêntico ao atual; não introduzir novas funcionalidades, endpoints ou mudanças de contrato de API.
  - Mover a lógica de validação e tratamento de erros para `middlewares/` (validação e erros), sem mudar as respostas HTTP existentes.
  - Separar a configuração de conexões (pg pool, Gemini, Elasticsearch) em `src/config/`, lendo variáveis de ambiente de forma centralizada.
  ```

- **O que a IA respondeu:**
  - Criou a estrutura modular em `backend/src/{config,services,routes,middlewares}`.
  - Centralizou a validação de variáveis de ambiente em [`src/config/env.ts`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/src/config/env.ts) e o singleton do Prisma em [`src/config/prisma.ts`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/src/config/prisma.ts).
  - Migrou `embeddings.js` para [`src/services/embeddingService.ts`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/src/services/embeddingService.ts) com tipagem estrita (`strict: true` no `tsconfig.json`).

- **Adaptações manuais realizadas:**
  - Adicionei wrappers de entrada CommonJS ([`src/seed.js`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/src/seed.js) e [`scripts/benchmark.js`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/scripts/benchmark.js)) utilizando `require('tsx/cjs')` para garantir que comandos executados diretamente com `node` (como `node src/seed.js` exigido no roteiro de avaliação) funcionem sem exigir compilação prévia manual com `tsc`.

---

### Fase 3 — Seed Idempotente de 5.000 Chamados (`node src/seed.js`)

- **Data:** `2026-11-08`
- **Autor:** `Nizo0UZ` (Lucas)
- **Prompt utilizado:**
  > *"Implemente o seeder idempotente em `src/seed.ts` utilizando `@faker-js/faker` (locale `pt_BR`) e `bcrypt` para gerar: 10 categorias de TI, 50 usuários com papéis (`SOLICITANTE`, `ATENDENTE`, `ADMIN`) e senhas com hash `bcrypt`, 20 artigos técnicos da base de conhecimento, e 5.000 chamados (sendo 40 chamados realistas de TI escritos à mão com soluções detalhadas + 4.960 chamados sintéticos), além de comentários e associações N:N de tags (`ChamadoTag`). Insira em lotes com `createMany` dentro de `prisma.$transaction` e gere os embeddings dos chamados realistas e artigos respeitando a cota gratuita do Gemini."*

- **O que a IA respondeu:**
  - Criou [`backend/src/seed.ts`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/src/seed.ts) com 40 incidentes reais de TI (VPN FortiClient, BitLocker 48 dígitos, impressora manchando/atolando, senha do Active Directory, certificado SEFAZ A1, etc.), 20 artigos completos e 4.960 chamados gerados via Faker (`pt_BR` com semente fixa `faker.seed(20261108)` para reprodutibilidade).

- **Adaptações manuais realizadas:**
  1. **Controle de cota (Rate-Limit) do Gemini no Seed:**
     - Gerar 5.000 embeddings na API gratuita do Gemini durante o `seed` excederia o limite de requisições por minuto (RPM). Ajustei o `seed.ts` para gerar embeddings reais na API Gemini apenas para os **40 chamados realistas** e **20 artigos** (em lotes de 20 com pausa de `1.500 ms`), deixando a flag `--skip-embeddings` disponível e um script dedicado `npm run reindex`.
  2. **Reinício determinístico das sequências (`ALTER SEQUENCE ... RESTART WITH 1`) e sincronização com Elasticsearch:**
     - Como `deleteMany()` não reseta contadores `SERIAL` no PostgreSQL, adicionei `ALTER SEQUENCE ... RESTART WITH 1` na transação de limpeza para garantir que os IDs comecem sempre em `1` após rodar `node src/seed.js`, além de disparar a sincronização Bulk com o Elasticsearch ao final do seed.

---

### Fase 4 — API REST (Express + Zod), Transações ACID e Tratamento de Erros

- **Data:** `2026-11-08`
- **Autor:** `Nizo0UZ` (Lucas)
- **Prompt utilizado (na íntegra — ver [`backend/prompts.md`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/prompts.md#L94-L127)):**
  ```markdown
  Você é um engenheiro de back-end sênior especializado em Node.js, Express, Prisma ORM e PostgreSQL, com experiência em APIs REST de sistemas de help desk e gestão de chamados. Sua tarefa é implementar a Fase 4 de um projeto existente: uma API REST em Express que expõe as rotas mínimas descritas abaixo, com validação de entrada, operações transacionais e tratamento centralizado de erros do Prisma.

  Antes de tudo, instale `express` e uma biblioteca de validação, `zod`, e use-as como base de toda a validação de entrada.

  **Rotas obrigatórias**

  - `POST /categorias` e `GET /categorias`
  - `POST /usuarios` e `GET /usuarios`
  - `POST /chamados`: cria o chamado e gera o embedding dele na mesma operação, de modo que o chamado e seu embedding sejam persistidos juntos ou nenhum dos dois seja.
  - `GET /chamados`: aceita filtros por `status`, `categoria` e `prioridade`, e paginação.
  - `GET /chamados/:id`: retorna o chamado com `include` de categoria, solicitante, atendente, comentários e tags.
  - `PATCH /chamados/:id/status`
  - `POST /chamados/:id/comentarios`
  - `POST /artigos` e `GET /artigos`

  **Regras de negócio transacionais**

  Use `prisma.$transaction` em toda operação composta. O caso central é "resolver chamado", que deve, dentro de uma única transação, atualizar o status, gravar a solução, criar o comentário correspondente e reindexar (regenerar o embedding) o chamado. Se qualquer etapa falhar, todas devem ser revertidas.

  Aplique estas regras de negócio:
  - Somente um usuário com papel `ATENDENTE` pode ser atribuído como atendente de um chamado. Qualquer outro papel deve ser rejeitado.
  - Um chamado com status `FECHADO` não pode ser reaberto. Tentativas de transição a partir de `FECHADO` devem ser recusadas.

  Quando uma regra for violada por dados do cliente, responda com erro de validação ou de conflito, não com erro interno.

  **Middleware de erros**

  Crie um middleware centralizado de erros que traduza erros conhecidos do Prisma para respostas HTTP adequadas: `P2002` (violação de unicidade) deve virar `409`, e `P2003` (violação de chave estrangeira) deve virar `400`. Erros de validação do zod devem virar `400` com os detalhes dos campos inválidos. Erros não reconhecidos devem virar `500` sem vazar detalhes internos na resposta.

  **Escopo**

  Implemente apenas o que está listado. Não adicione autenticação, paginação em rotas que não a pedem, camadas de arquitetura extras nem funcionalidades fora da lista. Mantenha a estrutura de pastas e os padrões já existentes no projeto. Inclua testes que cubram pelo menos a transação de resolver chamado, a regra de atendente e a regra de não reabrir chamado fechado.
  ```

- **O que a IA respondeu:**
  - Implementou as rotas REST com validação `zod`, o serviço transacional [`src/services/chamadoService.ts`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/src/services/chamadoService.ts), o middleware [`src/middlewares/erros.ts`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/src/middlewares/erros.ts) e a suíte de testes [`src/chamados.test.ts`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/src/chamados.test.ts).

- **Adaptações manuais realizadas:**
  - No Prisma 7 com driver adapter `@prisma/adapter-pg`, conexões transacionais interativas (`prisma.$transaction(async (tx) => ...)`) possuem timeout padrão de 5 segundos. Para evitar que a chamada externa HTTP à API do Gemini (`gerarEmbeddingDocumento`) mantivesse a transação PostgreSQL aberta por muito tempo ou falhasse sob instabilidade de rede, ajustei o fluxo para gerar o vetor e persistir na tabela `"Documentos"` usando o cliente transacional `tx.$executeRaw` com timeout estendido (`maxWait: 10000, timeout: 20000`), além de sincronizar de forma assíncrona o documento atualizado com o Elasticsearch.

---

### Fase 5 & 6 — Recuperação Inteligente (RAG) e Busca Full-Text (Elasticsearch)

- **Data:** `2026-11-08`
- **Autor:** `Nizo0UZ` (Lucas)
- **Prompt utilizado:**
  > *"Implemente a Fase 5 (RAG — Trilha C) e a Fase 6 (Elasticsearch — Trilha B):*
  > *1. `GET /busca/semantica?q=...&k=5` combinando similaridade vetorial (`ORDER BY embedding <=> $1`) com filtros relacionais (`status`, `categoriaId`) e limiar mínimo de similaridade.*
  > *2. `POST /rag/perguntar` que recupera os top-K chamados/artigos mais similares no `pgvector` e envia como contexto ao Gemini para gerar uma resposta sugerida citando os IDs usados (`[Chamado #id]`, `[Artigo #id]`).*
  > *3. Criação do índice `chamados` no Elasticsearch com analisador `brazilian`, script de sincronização em massa (`bulk`), rota `GET /busca/texto?q=...` com `multi_match`, `fuzziness: AUTO` e `highlight`, e rota `GET /busca/comparar` confrontando `ILIKE` × `Elasticsearch` × `pgvector`."*

- **O que a IA respondeu:**
  - Implementou [`src/services/ragService.ts`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/src/services/ragService.ts), [`src/services/buscaService.ts`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/src/services/buscaService.ts), [`src/routes/busca.ts`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/src/routes/busca.ts) e [`scripts/sincronizar-elastic.ts`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/scripts/sincronizar-elastic.ts).

- **Adaptações manuais realizadas:**
  - Configurei uma cadeia de fallback automático de modelos generativos em [`src/config/gemini.ts`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/src/config/gemini.ts) (`gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-2.0-flash-lite`): se o modelo principal retornar erro `429` (cota gratuita) ou `503`, o `ragService.ts` tenta automaticamente o próximo modelo e informa no JSON final qual `modeloGeracao` respondeu.

---

### Fase 7 — Desempenho nas Consultas (`EXPLAIN ANALYZE`, Índices Compostos/GIN e Benchmark)

- **Data:** `2026-11-08`
- **Autor:** `Nizo0UZ` (Lucas)
- **Prompt utilizado:**
  > *"Desempenho (critério 'desempenho nas consultas'):*
  > *1. Rodar `EXPLAIN ANALYZE` nas consultas principais e mostrar o uso dos índices (B-tree em `status`/`categoria_id`, HNSW no `embedding`).*
  > *2. Medir o tempo da busca por `ILIKE '%...%'` × `pgvector` × `Elasticsearch` em 5000+ registros (script `scripts/benchmark.js`).*
  > *3. Avaliar índices compostos (ex.: `[status, categoriaId]`) e, opcionalmente, full-text nativo do Postgres (`tsvector` + GIN).*
  > *4. Registrar os resultados em uma seção do `README.md`."*

- **O que a IA respondeu:**
  - Adicionou `@@index([status, categoriaId])` ao `schema.prisma`, criou a migration [`20261108221000_indice_composto_status_categoria_fts_gin/migration.sql`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/prisma/migrations/20261108221000_indice_composto_status_categoria_fts_gin/migration.sql) e desenvolveu [`scripts/benchmark.ts`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/scripts/benchmark.ts).

- **Adaptações manuais realizadas:**
  1. **Otimização da Query Vetorial (`HNSW`) para o Planner do PostgreSQL:**
     - Ao popular **5.020 vetores de 1.536 dimensões** na tabela `"Documentos"`, observei no `EXPLAIN (ANALYZE, BUFFERS)` que fazer `LEFT JOIN "Chamado"` antes do `ORDER BY d.embedding <=> $1 LIMIT $2` (parametrizado) fazia o otimizador do PostgreSQL estimar custo `~952` para o `Index Scan` contra `628.23` para o `Seq Scan`, deixando de usar o índice HNSW quando `enable_seqscan = on`.
     - Reescrevi [`buscarSimilares`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/src/services/embeddingService.ts#L50-L92) isolando a busca ANN em uma subquery interna (`top_docs`) com `LIMIT` inteiro literal saneado *antes* dos `LEFT JOIN` com `"Chamado"` e `"Categoria"`. O custo planejado caiu para `524.65` e a busca vetorial passou a executar `Index Scan using documentos_embedding_hnsw_idx` em **0,916 ms** (contra **41,871 ms** do `Seq Scan` — **45,7x mais rápido**).
  2. **Cache de `pgvector.registerTypes` por conexão física do Pool:**
     - Em [`src/config/pg.ts`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/src/config/pg.ts), adicionei um `WeakSet<PoolClient>` no evento `pool.on('connect')` para registrar os tipos do `pgvector` uma única vez por conexão criada no pool.

---

## 3. Verificação do Fluxo de Auditoria (`docker-compose up -d` → `npx prisma migrate` → `node src/seed.js`)

O fluxo completo exigido para correção e auditoria do professor foi validado passo a passo:

1. **`cp .env.example .env`** — cria o arquivo `.env` a partir do template versionado [`.env.example`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/.env.example) contendo `DATABASE_URL`, `ELASTICSEARCH_URL`, `GEMINI_API_KEY` e `PORT`.
2. **`docker-compose up -d`** — inicia os containers `willen_postgres` (`pgvector/pgvector:pg16` com healthcheck `pg_isready`), `willen_elasticsearch` (`elasticsearch:9.5.6`) e `willen_pgadmin`.
3. **`npm install`** — instala as dependências e aciona automaticamente o hook `postinstall` (`prisma generate`), gerando o Prisma Client em `generated/prisma`.
4. **`npx prisma migrate dev`** (ou `npx prisma migrate deploy`) — aplica em ordem as 5 migrations versionadas em `prisma/migrations/`, criando todas as 8 tabelas, FKs (`ON DELETE RESTRICT / CASCADE / SET NULL`), índices B-tree simples e compostos (`Chamado_status_categoria_id_idx`, `Comentario_chamado_id_criado_em_idx`), índice funcional GIN (`chamado_fts_gin_idx`) e índice vetorial HNSW (`documentos_embedding_hnsw_idx`).
5. **`node src/seed.js`** — executa [`src/seed.js`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/src/seed.js) → [`src/seed.ts`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/src/seed.ts), limpando a base com reinício determinístico de sequências (`RESTART WITH 1`), inserindo **10 categorias**, **20 tags**, **50 usuários** (com hash `bcrypt`), **20 artigos**, **5.000 chamados** (40 realistas resolvidos + 4.960 via Faker `pt_BR`), **~6.032 comentários**, gerando os embeddings de 1.536 dimensões no `pgvector` e sincronizando os **5.000 chamados** no índice `chamados` do Elasticsearch via Bulk API.
6. **`npm run dev`** — sobe a API REST Express na porta `3000`, pronta para ser testada pelo arquivo [`requests.http`](file:///c:/Users/lucas/OneDrive/Documentos/Faculdade/ProjetoWillen/backend/requests.http).
