# IA_LOG — Registro de Uso de Inteligência Artificial

Este arquivo documenta as interações com IA durante o desenvolvimento do projeto, incluindo os prompts utilizados, as respostas geradas e as adaptações/intervenções manuais necessárias.

---

## Entrada 1 — Enriquecimento da modelagem Prisma, preservação do índice HNSW (pgvector) e migração para o padrão Prisma 7

- **Data:** 2026-11-08
- **Escopo:** `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261108214949_comentarios_tags_artigo_autor_categoria_solucao/migration.sql`, `backend/scripts/teste-prisma.ts`, `backend/package.json`
- **Prompt resumido:** Enriquecer o schema Prisma do sistema de chamados com `Comentario` (1:N com `Chamado` e `Usuario`), `Tag` e `ChamadoTag` (N:N explícito), `Artigo` ligado a `Usuario` (autor) e `Categoria`, e campos `solucao` e `resolvidoEm` em `Chamado`, todos com `onDelete` explícito e justificado; gerar a migration preservando o índice vetorial HNSW; ajustar gerador e driver adapter para o padrão do Prisma 7 e validar com um script `findMany`.

### 1. Decisões de modelagem e `onDelete`

| Relação | Cardinalidade | `onDelete` | Justificativa de negócio |
|---|---|---|---|
| `Chamado.categoria` → `Categoria` | N:1 obrigatória | `Restrict` | Categorias possuem flag `ativa`. Não se deve apagar uma categoria que já classifica chamados; o fluxo correto é desativá-la (`ativa = false`). |
| `Chamado.solicitante` → `Usuario` | N:1 obrigatória | `Restrict` | Apagar o solicitante deixaria o histórico de chamados órfão ou exigiria apagá-los em cascata. Usuários são desativados (`ativo = false`). |
| `Chamado.atendente` → `Usuario` | N:1 opcional | `SetNull` | Se o cadastro de um atendente for removido excepcionalmente, o chamado continua existindo e volta ao estado não atribuído (`atendente_id = NULL`). |
| `Comentario.chamado` → `Chamado` | N:1 obrigatória | `Cascade` | Comentários são parte intrínseca do histórico daquele chamado; se o chamado for excluído, seus comentários não têm sentido isoladamente. |
| `Comentario.autor` → `Usuario` | N:1 obrigatória | `Restrict` | Impede apagar acidentalmente um usuário que já interagiu em chamados, preservando a auditoria/autoria do histórico de atendimento. |
| `ChamadoTag.chamado` → `Chamado` | N:1 (junção N:N) | `Cascade` | A linha da tabela de junção representa apenas o vínculo; se o chamado deixa de existir, o vínculo é removido. |
| `ChamadoTag.tag` → `Tag` | N:1 (junção N:N) | `Cascade` | Excluir uma tag do sistema apenas desfaz a associação nos chamados, mantendo os chamados intactos. |
| `Artigo.autor` → `Usuario` | N:1 obrigatória | `Restrict` | Protege artigos publicados na base de conhecimento contra exclusão acidental do usuário autor. |
| `Artigo.categoria` → `Categoria` | N:1 obrigatória | `Restrict` | Mesma entidade `Categoria` usada em `Chamado` (unifica a taxonomia entre tickets e base de conhecimento); bloqueia exclusão de categoria em uso. |
| `Documentos.chamado` → `Chamado` | N:1 opcional | `SetNull` | O trecho indexado (embedding) permanece consultável mesmo se o registro relacional de origem for removido. |
| `Documentos.artigo` → `Artigo` | N:1 opcional | `SetNull` | Idem para artigos da base de conhecimento. |

### 2. Migration e intervenção manual no SQL (Índice HNSW / pgvector)

- **Problema encontrado:**
  1. O Prisma 7.10 não suporta índices `Hnsw` na DSL do schema (`@@index([embedding], type: Hnsw)` falha na validação com `Error P1012: Unknown index type: Hnsw`), pois a coluna `embedding` é `Unsupported("vector(1536)")`.
  2. Como o índice `documentos_embedding_hnsw_idx` não pode ser declarado no `schema.prisma`, o Prisma Migrate enxerga esse índice existente no banco como *drift* e gera `DROP INDEX "documentos_embedding_hnsw_idx";`.
  3. Na migration anterior (`20261108213939_documentos_fk_chamado_artigo`), que já estava criada na pasta `prisma/migrations/` mas ainda pendente de aplicação no banco, a primeira instrução gerada pelo Prisma havia sido justamente `DROP INDEX "documentos_embedding_hnsw_idx";`.

- **Como foi resolvido:**
  1. Não alteramos a migration antiga (`20261108213939_documentos_fk_chamado_artigo`) para não violar a imutabilidade do histórico de migrations já versionadas.
  2. Geramos a nova migration com `--create-only`:
     ```bash
     npx prisma migrate dev --create-only --name comentarios_tags_artigo_autor_categoria_solucao
     ```
  3. Editamos manualmente o arquivo `prisma/migrations/20261108214949_comentarios_tags_artigo_autor_categoria_solucao/migration.sql`, adicionando ao final a recriação idempotente do índice HNSW com os mesmos parâmetros originais (`m = 16`, `ef_construction = 64`, `vector_cosine_ops`):
     ```sql
     CREATE INDEX IF NOT EXISTS documentos_embedding_hnsw_idx
         ON "Documentos"
         USING hnsw (embedding vector_cosine_ops)
         WITH (m = 16, ef_construction = 64);
     ```
  4. Aplicamos a migration com `npx prisma migrate deploy` (evitando um segundo ciclo de diff do `migrate dev` que tentaria gerar outro `DROP INDEX`) e conferimos em `pg_indexes` que `documentos_embedding_hnsw_idx` está ativo na tabela `"Documentos"`.
  5. Documentamos o aviso no próprio `schema.prisma` acima do `model Documentos` para que futuras migrations sigam sempre o fluxo `--create-only` → remover `DROP INDEX "documentos_embedding_hnsw_idx"` → `migrate deploy`.

### 3. Configuração do Prisma 7 (`prisma-client` + Driver Adapter)

- **Mudança no gerador (`schema.prisma`):**
  Substituído o provedor legado `prisma-client-js` pelo novo padrão do Prisma 7:
  ```prisma
  generator client {
    provider        = "prisma-client"
    output          = "../generated/prisma"
    moduleFormat    = "cjs"
    previewFeatures = ["postgresqlExtensions"]
  }
  ```
  *Observação sobre `moduleFormat = "cjs"`:* como o `backend/package.json` usa `"type": "commonjs"` e possui scripts `.js` em CommonJS (`require`), definir `moduleFormat = "cjs"` garante compatibilidade tanto para scripts TypeScript executados via `tsx` quanto para módulos CommonJS do projeto.

- **Impacto nas importações e instanciação do Client:**
  - **Onde importar:** no Prisma 7 com `provider = "prisma-client"`, o código do cliente não fica mais oculto dentro de `node_modules/@prisma/client`, e sim gerado em `backend/generated/prisma` (diretório já listado no `.gitignore`). A importação passa a apontar para `../generated/prisma/client` (após rodar `npx prisma generate`).
  - **Como conectar:** a URL do banco não fica no `schema.prisma` (fica em `prisma.config.ts` para a CLI) e o `PrismaClient` exige um *driver adapter* em tempo de execução. Foi instalado `@prisma/adapter-pg` e a instância é criada passando `new PrismaPg({ connectionString: process.env.DATABASE_URL })`:
    ```ts
    import { PrismaPg } from "@prisma/adapter-pg";
    import { PrismaClient } from "../generated/prisma/client";

    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    const prisma = new PrismaClient({ adapter });
    ```
  - **Teste executado:** criado e executado `npx tsx scripts/teste-prisma.ts`, que conectou ao PostgreSQL via `@prisma/adapter-pg`, listou os 2 registros existentes em `Documentos` com `findMany` e consultou a contagem de todas as 7 tabelas relacionais via `$transaction`.


---

## Entrada 2 — Análise de Desempenho (`EXPLAIN ANALYZE`), Índices Compostos/GIN e Benchmark em 5.000+ Registros

- **Data:** 2026-11-08
- **Escopo:** `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261108221000_indice_composto_status_categoria_fts_gin/migration.sql`, `backend/src/config/pg.ts`, `backend/src/services/embeddingService.ts`, `backend/scripts/benchmark.ts`, `backend/scripts/benchmark.js`, `README.md`
- **Prompt resumido:** Executar `EXPLAIN ANALYZE` nas consultas principais comprovando o uso dos índices (`B-tree` em `status`/`categoria_id`, `HNSW` em `embedding`), medir a latência de `ILIKE '%...%'` × `pgvector` × `Elasticsearch` em 5.000+ registros via `scripts/benchmark.js`, avaliar índices compostos (`[status, categoriaId]`) e Full-Text nativo do Postgres (`tsvector` + `GIN`), e documentar os resultados no `README.md`.

### 1. Otimização do Planner do PostgreSQL para HNSW com `LEFT JOIN`

- **Problema identificado:**
  - Na consulta original de `buscarSimilares` (`backend/src/services/embeddingService.ts`), o `ORDER BY d.embedding <=> $1 LIMIT $2` era aplicado *após* o `LEFT JOIN` com `"Chamado"`, `"Categoria"` e `"Artigo"`, usando `LIMIT` parametrizado (`$2`).
  - O otimizador de custos do PostgreSQL estima o custo de um `LIMIT $2` desconhecido em tempo de planejamento como ~10% da tabela. Com 5.020 vetores de 1.536 dimensões (`~31 MB` em TOAST), o custo estimado do `Index Scan using documentos_embedding_hnsw_idx` subia para `~952`, ultrapassando o custo estimado do `Seq Scan` (`~628.23`), o que faria o planner abandonar o índice HNSW em consultas com `JOIN` quando `enable_seqscan = on`.
- **Intervenção e ajuste:**
  1. Reestruturamos `buscarSimilares` para isolar a busca ANN em uma subquery interna (`top_docs`) com `LIMIT` inteiro literal saneado (`Math.max(1, Math.min(100, Math.floor(Number(limite) || 5)))`) e `WHERE d.embedding IS NOT NULL`, realizando os `LEFT JOIN` com `"Chamado"` e `"Categoria"` apenas sobre os *top-K* documentos retornados pelo índice HNSW.
  2. Quando `apenasChamados = true`, omitimos o `LEFT JOIN` desnecessário com `"Artigo"`.
  3. Em `backend/src/config/pg.ts`, adicionamos um `WeakSet<PoolClient>` no evento `pool.on('connect')` para registrar os tipos do `pgvector` (`registerTypes`) apenas uma vez por conexão física do pool, eliminando queries extras a `pg_type` e trocas de clientes a cada chamada de `buscarSimilares`.
  4. **Resultado verificado no `EXPLAIN (ANALYZE, BUFFERS)`:** O custo planejado caiu para `524.65` (abaixo dos `628.23` do `Seq Scan`), garantindo `Index Scan using documentos_embedding_hnsw_idx` em **`0.916 ms`** (`789` buffers) contra **`41.871 ms`** (`30.577` buffers) do `Seq Scan` — **45,7x mais rápido**.

### 2. Índices Compostos e Full-Text Search Nativo (`tsvector` + `GIN`)

- **Índice Composto `"Chamado_status_categoria_id_idx"` (`@@index([status, categoriaId])`):**
  - Sem o índice composto, filtrar por `status = 'RESOLVIDO' AND categoria_id = 24` exigia um `BitmapAnd` combinando os dois índices simples (`Chamado_status_idx` e `Chamado_categoria_id_idx`), seguido de `Bitmap Heap Scan` (`0.343 ms`, `283` buffers).
  - Com o índice composto `(status, categoria_id)`, o PostgreSQL realiza `Index Only Scan` em **`0.087 ms`** lendo apenas **`8` buffers** (**3,94x mais rápido** e **97,2% menos páginas lidas**).
- **Índice Funcional GIN `"chamado_fts_gin_idx"`:**
  - Criado via migration SQL sobre `to_tsvector('portuguese', coalesce(titulo, '') || ' ' || coalesce(descricao, '') || ' ' || coalesce(solucao, ''))`.
  - Reduziu a busca textual no PostgreSQL de **`18.489 ms`** (`Seq Scan` do `ILIKE '%...%'`, `554` buffers) para **`0.097 ms`** (`Bitmap Index Scan on chamado_fts_gin_idx`, `8` buffers — **190x mais rápido** no motor do banco).
- **Preservação do índice HNSW:**
  - Assim como na Entrada 1, o arquivo `migration.sql` foi criado de forma a não remover `documentos_embedding_hnsw_idx` e garantir sua presença idempotente via `CREATE INDEX IF NOT EXISTS`.
