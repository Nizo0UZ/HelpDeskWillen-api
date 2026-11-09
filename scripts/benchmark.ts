import { performance } from 'node:perf_hooks';
import pgvector from 'pgvector/pg';
import { elasticClient, INDICE_CHAMADOS } from '../src/config/elastic';
import { LIMIAR_SIMILARIDADE_PADRAO } from '../src/config/gemini';
import { clienteComVetor, encerrarPool, pool } from '../src/config/pg';
import { prisma, StatusChamado } from '../src/config/prisma';
import {
  buscarPorTextoElastic,
  sincronizarTodosChamadosBulk,
} from '../src/services/buscaService';
import {
  buscarSimilares,
  gerarEmbedding,
} from '../src/services/embeddingService';

interface EstatisticasTempo {
  modalidade: string;
  amostras: number;
  mediaMs: number;
  medianaMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

interface ResultadoQualidadeQuery {
  pergunta: string;
  cenario: string;
  ilikeTotal: number;
  ilikeTop1: string;
  ftsGinTotal: number;
  ftsGinTop1: string;
  elasticTotal: number;
  elasticTop1: string;
  pgvectorTotal: number;
  pgvectorTop1: string;
  pgvectorSimilaridadeTop1: number | null;
}

const DIMENSOES_VETOR = 1536;
const META_MINIMA_REGISTROS = 5000;
const ITERACOES_POR_QUERY = 10;

const PERGUNTAS_BENCHMARK: ReadonlyArray<{
  pergunta: string;
  termoIlike: string;
  cenario: string;
}> = [
  {
    pergunta: 'impressora manchando folha e atolando papel',
    termoIlike: 'manchando',
    cenario: 'Termos exatos / flexão verbal',
  },
  {
    pergunta: 'impresora atolando papel na bandeja',
    termoIlike: 'impresora',
    cenario: 'Erro de digitação (typo: "impresora")',
  },
  {
    pergunta: 'nao consigo entrar no notebook porque esqueci minha credencial',
    termoIlike: 'esqueci minha credencial',
    cenario: 'Linguagem natural / sinônimo ("credencial" vs "senha")',
  },
  {
    pergunta: 'vpn forticlient trava em 40% com erro de certificado',
    termoIlike: 'FortiClient',
    cenario: 'Incidente técnico específico (VPN / Certificado)',
  },
  {
    pergunta: 'tela azul bitlocker pedindo chave de recuperacao de 48 digitos',
    termoIlike: 'BitLocker',
    cenario: 'Busca por código / tecnologia exata (BitLocker)',
  },
];

/**
 * Gera um vetor unitário determinístico de 1536 dimensões a partir de uma semente inteira.
 * Usado apenas para preencher os ~5000 chamados sintéticos do Faker na tabela "Documentos"
 * sem consumir cota da API Gemini, mantendo os 60 embeddings reais do Gemini intactos.
 */
function gerarVetorUnitarioSintetico(semente: number): number[] {
  const vetor = new Array<number>(DIMENSOES_VETOR);
  let estado = (semente * 1664525 + 1013904223) >>> 0;
  let somaQuadrados = 0;

  for (let i = 0; i < DIMENSOES_VETOR; i++) {
    estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0;
    const val = (estado / 0xffffffff) * 2 - 1;
    vetor[i] = val;
    somaQuadrados += val * val;
  }

  const norma = Math.sqrt(somaQuadrados) || 1;
  for (let i = 0; i < DIMENSOES_VETOR; i++) {
    vetor[i] = Number((vetor[i] / norma).toFixed(6));
  }

  return vetor;
}

function calcularEstatisticas(
  modalidade: string,
  temposMs: number[]
): EstatisticasTempo {
  const ordenados = [...temposMs].sort((a, b) => a - b);
  const n = ordenados.length;
  const soma = ordenados.reduce((acc, v) => acc + v, 0);
  const media = soma / n;
  const mediana =
    n % 2 === 1
      ? ordenados[Math.floor(n / 2)]
      : (ordenados[n / 2 - 1] + ordenados[n / 2]) / 2;
  const idxP95 = Math.min(n - 1, Math.ceil(n * 0.95) - 1);
  const p95 = ordenados[idxP95];

  return {
    modalidade,
    amostras: n,
    mediaMs: Number(media.toFixed(2)),
    medianaMs: Number(mediana.toFixed(2)),
    p95Ms: Number(p95.toFixed(2)),
    minMs: Number(ordenados[0].toFixed(2)),
    maxMs: Number(ordenados[n - 1].toFixed(2)),
  };
}

async function executarExplainAnalyze(
  titulo: string,
  sql: string,
  params: unknown[] = [],
  configSessao: string[] = []
): Promise<string[]> {
  const client = await clienteComVetor();
  try {
    await client.query('BEGIN');
    for (const cmd of configSessao) {
      await client.query(cmd);
    }
    const { rows } = await client.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
      params
    );
    await client.query('ROLLBACK');

    const linhas = rows.map((r) =>
      r['QUERY PLAN'].replace(/'\[[-0-9.,eE+]+\]'::vector/g, "'[...1536 dims...]'::vector")
    );
    console.log(`\n📌 ${titulo}`);
    console.log('-'.repeat(88));
    for (const linha of linhas) {
      console.log(`  ${linha}`);
    }
    return linhas;
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    client.release();
  }
}

/**
 * Garante que a tabela "Documentos" possua 5000+ registros com vetores de 1536 dimensões
 * (preservando os embeddings reais gerados pelo Gemini e preenchendo os chamados Faker restantes),
 * que o índice HNSW e GIN existam e que o Elasticsearch esteja sincronizado com 5000+ registros.
 */
async function prepararAmbiente5000Registros(): Promise<{
  totalChamados: number;
  totalDocumentos: number;
  totalComentarios: number;
  totalElastic: number;
}> {
  console.log('========================================================================================');
  console.log('1. PREPARAÇÃO E VERIFICAÇÃO DO AMBIENTE (5.000+ REGISTROS EM TODOS OS MOTORES)');
  console.log('========================================================================================');

  const totalChamados = await prisma.chamado.count();
  const totalComentarios = await prisma.comentario.count();

  if (totalChamados < META_MINIMA_REGISTROS) {
    throw new Error(
      `O banco possui apenas ${totalChamados} chamados (mínimo exigido: ${META_MINIMA_REGISTROS}). Execute "npm run seed" antes do benchmark.`
    );
  }

  // Verificar quantos documentos vetoriais existem em "Documentos"
  const { rows: docCountRows } = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM "Documentos"`
  );
  let totalDocumentos = docCountRows[0].total;

  if (totalDocumentos < META_MINIMA_REGISTROS) {
    console.log(
      `ℹ️ Tabela "Documentos" possui ${totalDocumentos} embeddings (gerados via API Gemini).`
    );
    console.log(
      `⚙️ Preenchendo vetores de 1536 dimensões para os demais chamados até atingir 5.000+ registros em "Documentos" (preservando os embeddings reais da API Gemini)...`
    );

    const { rows: chamadosSemDoc } = await pool.query<{
      id: number;
      titulo: string;
      descricao: string;
      solucao: string | null;
      categoria_nome: string;
    }>(`
      SELECT c.id, c.titulo, c.descricao, c.solucao, cat.nome AS categoria_nome
      FROM "Chamado" c
      JOIN "Categoria" cat ON cat.id = c.categoria_id
      WHERE NOT EXISTS (
        SELECT 1 FROM "Documentos" d WHERE d.chamado_id = c.id
      )
      ORDER BY c.id ASC
    `);

    const client = await clienteComVetor();
    const tamanhoLote = 500;
    try {
      for (let i = 0; i < chamadosSemDoc.length; i += tamanhoLote) {
        const lote = chamadosSemDoc.slice(i, i + tamanhoLote);
        const valores: unknown[] = [];
        const placeholders: string[] = [];

        lote.forEach((ch, idx) => {
          const offset = idx * 4;
          placeholders.push(
            `($${offset + 1}, $${offset + 2}::jsonb, $${offset + 3}::vector, $${offset + 4})`
          );
          const conteudo = [
            `[CHAMADO #${ch.id}] ${ch.titulo}`,
            `Categoria: ${ch.categoria_nome}`,
            `Problema: ${ch.descricao}`,
            ...(ch.solucao ? [`Solução aplicada: ${ch.solucao}`] : []),
          ].join('\n');
          const metadata = JSON.stringify({
            chamado_id: ch.id,
            titulo: ch.titulo,
            categoria: ch.categoria_nome,
            origem: 'benchmark_backfill_sintetico',
          });
          const vetorSql = String(pgvector.toSql(gerarVetorUnitarioSintetico(ch.id)));
          valores.push(conteudo, metadata, vetorSql, ch.id);
        });

        await client.query(
          `INSERT INTO "Documentos" (conteudo, metadata, embedding, chamado_id)
           VALUES ${placeholders.join(', ')}`,
          valores
        );
      }
    } finally {
      client.release();
    }

    const { rows: novoCount } = await pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM "Documentos"`
    );
    totalDocumentos = novoCount[0].total;
    console.log(`✅ Tabela "Documentos" agora conta com ${totalDocumentos} vetores de 1536 dimensões.`);
  }

  // Garantir índices HNSW, Composto (status, categoria_id) e GIN (tsvector)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS documentos_embedding_hnsw_idx
      ON "Documentos"
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS "Chamado_status_categoria_id_idx"
      ON "Chamado"("status", "categoria_id");
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS "chamado_fts_gin_idx"
      ON "Chamado"
      USING gin (
        to_tsvector(
          'portuguese',
          coalesce("titulo", '') || ' ' || coalesce("descricao", '') || ' ' || coalesce("solucao", '')
        )
      );
  `);

  // Atualizar estatísticas e visibility map do PostgreSQL para planos precisos no EXPLAIN ANALYZE
  await pool.query(`VACUUM ANALYZE "Chamado";`);
  await pool.query(`VACUUM ANALYZE "Documentos";`);
  await pool.query(`VACUUM ANALYZE "Comentario";`);
  await pool.query(`VACUUM ANALYZE "Categoria";`);

  // Verificar sincronização do Elasticsearch
  let totalElastic = 0;
  const indiceExiste = await elasticClient.indices.exists({
    index: INDICE_CHAMADOS,
  });

  if (indiceExiste) {
    const countResp = await elasticClient.count({ index: INDICE_CHAMADOS });
    totalElastic = countResp.count;
  }

  if (totalElastic < META_MINIMA_REGISTROS) {
    console.log(
      `🔄 Índice Elasticsearch "${INDICE_CHAMADOS}" possui ${totalElastic} docs. Sincronizando em massa (bulk)...`
    );
    const resumoBulk = await sincronizarTodosChamadosBulk({
      recriarIndice: true,
      tamanhoLote: 1000,
    });
    totalElastic = resumoBulk.totalIndexados;
  }

  console.log('\n📊 Resumo de volumetria carregada para o benchmark:');
  console.table([
    { Motor_Tabela: 'PostgreSQL — Tabela "Chamado"', Registros: totalChamados },
    { Motor_Tabela: 'PostgreSQL — Tabela "Comentario"', Registros: totalComentarios },
    { Motor_Tabela: 'PostgreSQL / pgvector — Tabela "Documentos" (vector 1536)', Registros: totalDocumentos },
    { Motor_Tabela: `Elasticsearch — Índice "${INDICE_CHAMADOS}"`, Registros: totalElastic },
  ]);

  return {
    totalChamados,
    totalDocumentos,
    totalComentarios,
    totalElastic,
  };
}

/**
 * Lista todos os índices relevantes criados no PostgreSQL.
 */
async function listarIndicesAtivos(): Promise<void> {
  const { rows } = await pool.query<{
    tablename: string;
    indexname: string;
    tamanho: string;
    indexdef: string;
  }>(`
    SELECT
      tablename,
      indexname,
      pg_size_pretty(pg_relation_size(quote_ident(indexname)::regclass)) AS tamanho,
      indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('Chamado', 'Documentos', 'Comentario')
    ORDER BY tablename, indexname;
  `);

  console.log('\n📋 Índices ativos no PostgreSQL ("Chamado", "Comentario", "Documentos"):');
  console.table(
    rows.map((r) => ({
      Tabela: r.tablename,
      Indice: r.indexname,
      Tamanho: r.tamanho,
      Definicao:
        r.indexdef.length > 82 ? `${r.indexdef.substring(0, 82)}...` : r.indexdef,
    }))
  );
}

/**
 * Executa EXPLAIN (ANALYZE, BUFFERS) nas consultas principais e avalia o índice composto [status, categoriaId]
 * e o Full-Text Search nativo (tsvector + GIN).
 */
async function demonstrarExplainAnalyze(vetorExemploSql: string): Promise<void> {
  console.log('\n========================================================================================');
  console.log('2. EXPLAIN (ANALYZE, BUFFERS) NAS CONSULTAS PRINCIPAIS E AVALIAÇÃO DE ÍNDICES');
  console.log('========================================================================================');

  // Descobrir IDs reais do banco (pois o seed recria registros e incrementa sequences SERIAL)
  const { rows: catRows } = await pool.query<{ categoria_id: number; total: number }>(`
    SELECT categoria_id, COUNT(*)::int AS total
    FROM "Chamado"
    GROUP BY categoria_id
    ORDER BY total DESC
    LIMIT 1
  `);
  const categoriaIdReal = catRows[0]?.categoria_id ?? 1;

  const { rows: comRows } = await pool.query<{ chamado_id: number; total: number }>(`
    SELECT chamado_id, COUNT(*)::int AS total
    FROM "Comentario"
    GROUP BY chamado_id
    ORDER BY total DESC
    LIMIT 1
  `);
  const chamadoIdComComentarios = comRows[0]?.chamado_id ?? 1;

  console.log(
    `ℹ️ IDs reais selecionados para análise: categoria_id=${categoriaIdReal} (${catRows[0]?.total ?? 0} chamados), chamado_id=${chamadoIdComComentarios} (${comRows[0]?.total ?? 0} comentários).`
  );

  // 2.1 Índice B-tree simples em categoria_id
  await executarExplainAnalyze(
    `Consulta 2.1 — Filtro por categoria_id=${categoriaIdReal} (uso do índice B-tree "Chamado_categoria_id_idx")`,
    `SELECT id, titulo, status, prioridade, categoria_id, criado_em
     FROM "Chamado"
     WHERE categoria_id = $1`,
    [categoriaIdReal]
  );

  // 2.2 Índice B-tree simples em status
  await executarExplainAnalyze(
    'Consulta 2.2 — Contagem/agrupamento por status (uso de Index Only Scan B-tree)',
    `SELECT status, COUNT(*)::int AS total
     FROM "Chamado"
     WHERE status = $1::"StatusChamado"
     GROUP BY status`,
    [StatusChamado.AGUARDANDO]
  );

  // 2.3 Avaliação de Índice Composto [status, categoriaId]: ANTES vs DEPOIS
  console.log('\n----------------------------------------------------------------------------------------');
  console.log('🔬 AVALIAÇÃO DO ÍNDICE COMPOSTO: "Chamado_status_categoria_id_idx" (status, categoria_id)');
  console.log('----------------------------------------------------------------------------------------');

  await pool.query(`DROP INDEX IF EXISTS "Chamado_status_categoria_id_idx";`);
  await pool.query(`ANALYZE "Chamado";`);

  await executarExplainAnalyze(
    `Consulta 2.3a — ANTES do Índice Composto: Filtro combinado WHERE status = 'RESOLVIDO' AND categoria_id = ${categoriaIdReal}`,
    `SELECT id, titulo, status, prioridade, categoria_id, criado_em
     FROM "Chamado"
     WHERE status = $1::"StatusChamado" AND categoria_id = $2`,
    [StatusChamado.RESOLVIDO, categoriaIdReal]
  );

  await executarExplainAnalyze(
    `Consulta 2.3b — ANTES do Índice Composto: Contagem WHERE status = 'RESOLVIDO' AND categoria_id = ${categoriaIdReal}`,
    `SELECT COUNT(*)::int
     FROM "Chamado"
     WHERE status = $1::"StatusChamado" AND categoria_id = $2`,
    [StatusChamado.RESOLVIDO, categoriaIdReal]
  );

  // Medir latência média (50 execuções) sem índice composto
  const temposSemComposto: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    await pool.query(
      `SELECT id, titulo, status, prioridade, categoria_id, criado_em
       FROM "Chamado"
       WHERE status = $1::"StatusChamado" AND categoria_id = $2`,
      [StatusChamado.RESOLVIDO, categoriaIdReal]
    );
    temposSemComposto.push(performance.now() - t0);
  }

  // Recriar índice composto e atualizar estatísticas
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "Chamado_status_categoria_id_idx"
      ON "Chamado"("status", "categoria_id");
  `);
  await pool.query(`VACUUM ANALYZE "Chamado";`);

  await executarExplainAnalyze(
    `Consulta 2.3c — DEPOIS do Índice Composto: Filtro combinado WHERE status = 'RESOLVIDO' AND categoria_id = ${categoriaIdReal}`,
    `SELECT id, titulo, status, prioridade, categoria_id, criado_em
     FROM "Chamado"
     WHERE status = $1::"StatusChamado" AND categoria_id = $2`,
    [StatusChamado.RESOLVIDO, categoriaIdReal]
  );

  await executarExplainAnalyze(
    `Consulta 2.3d — DEPOIS do Índice Composto: Contagem com Index Only Scan em "Chamado_status_categoria_id_idx"`,
    `SELECT COUNT(*)::int
     FROM "Chamado"
     WHERE status = $1::"StatusChamado" AND categoria_id = $2`,
    [StatusChamado.RESOLVIDO, categoriaIdReal]
  );

  // Medir latência média (50 execuções) com índice composto
  const temposComComposto: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    await pool.query(
      `SELECT id, titulo, status, prioridade, categoria_id, criado_em
       FROM "Chamado"
       WHERE status = $1::"StatusChamado" AND categoria_id = $2`,
      [StatusChamado.RESOLVIDO, categoriaIdReal]
    );
    temposComComposto.push(performance.now() - t0);
  }

  console.log('\n📊 Comparativo de Tempo — Filtro Combinado (status + categoria_id):');
  console.table([
    calcularEstatisticas('Sem Índice Composto (BitmapIndex + Filter na Heap)', temposSemComposto),
    calcularEstatisticas('Com Índice Composto "Chamado_status_categoria_id_idx"', temposComComposto),
  ]);

  // 2.4 Índice Composto em Comentario (chamado_id, criado_em)
  await executarExplainAnalyze(
    `Consulta 2.4 — Histórico de Comentários do Chamado #${chamadoIdComComentarios} (Índice Composto "Comentario_chamado_id_criado_em_idx")`,
    `SELECT id, conteudo, autor_id, criado_em
     FROM "Comentario"
     WHERE chamado_id = $1
     ORDER BY criado_em ASC`,
    [chamadoIdComComentarios]
  );

  // 2.5 Busca Vetorial no pgvector: Seq Scan (sem HNSW) vs Index Scan (com HNSW)
  console.log('\n----------------------------------------------------------------------------------------');
  console.log('🔬 AVALIAÇÃO DO ÍNDICE HNSW NO PGVECTOR: "documentos_embedding_hnsw_idx" (5.060 vetores)');
  console.log('----------------------------------------------------------------------------------------');

  await executarExplainAnalyze(
    'Consulta 2.5a — Busca Semântica pgvector COM índice HNSW ("documentos_embedding_hnsw_idx")',
    `SELECT
       d.id,
       d.chamado_id,
       d.artigo_id,
       (1 - (d.embedding <=> $1::vector))::FLOAT AS similaridade
     FROM "Documentos" d
     ORDER BY d.embedding <=> $1::vector
     LIMIT 5`,
    [vetorExemploSql]
  );

  await executarExplainAnalyze(
    'Consulta 2.5b — Busca Semântica pgvector HNSW + JOIN relacional com "Chamado" e "Categoria"',
    `SELECT
       top_docs.id,
       top_docs.chamado_id,
       top_docs.similaridade,
       c.titulo AS chamado_titulo,
       c.status AS chamado_status,
       cat.nome AS categoria_nome
     FROM (
       SELECT
         d.id,
         d.chamado_id,
         (1 - (d.embedding <=> $1::vector))::FLOAT AS similaridade
       FROM "Documentos" d
       ORDER BY d.embedding <=> $1::vector
       LIMIT 5
     ) top_docs
     LEFT JOIN "Chamado" c ON c.id = top_docs.chamado_id
     LEFT JOIN "Categoria" cat ON cat.id = c.categoria_id`,
    [vetorExemploSql]
  );

  await executarExplainAnalyze(
    'Consulta 2.5c — Busca Semântica pgvector SEM índice (forçando Seq Scan em 5.060 vetores para comparação)',
    `SELECT
       d.id,
       d.chamado_id,
       d.artigo_id,
       (1 - (d.embedding <=> $1::vector))::FLOAT AS similaridade
     FROM "Documentos" d
     ORDER BY d.embedding <=> $1::vector
     LIMIT 5`,
    [vetorExemploSql],
    ['SET LOCAL enable_indexscan = off', 'SET LOCAL enable_bitmapscan = off']
  );

  // 2.6 Busca Textual no PostgreSQL: ILIKE '%...%' (Seq Scan) vs Full-Text Nativo (tsvector + GIN)
  console.log('\n----------------------------------------------------------------------------------------');
  console.log('🔬 AVALIAÇÃO DE FULL-TEXT SEARCH NATIVO DO POSTGRESQL: ILIKE (Seq Scan) vs tsvector + GIN');
  console.log('----------------------------------------------------------------------------------------');

  await executarExplainAnalyze(
    'Consulta 2.6a — Busca por palavra-chave com ILIKE \'%impressora%\' (Sequential Scan em 5.040 registros)',
    `SELECT id, titulo, status, categoria_id, criado_em
     FROM "Chamado"
     WHERE titulo ILIKE $1
        OR descricao ILIKE $1
        OR solucao ILIKE $1
     ORDER BY criado_em DESC
     LIMIT 5`,
    ['%impressora%']
  );

  await executarExplainAnalyze(
    'Consulta 2.6b — Full-Text Search nativo do PostgreSQL (to_tsvector + plainto_tsquery com índice GIN "chamado_fts_gin_idx")',
    `SELECT
       id,
       titulo,
       status,
       categoria_id,
       ts_rank(
         to_tsvector('portuguese', coalesce(titulo, '') || ' ' || coalesce(descricao, '') || ' ' || coalesce(solucao, '')),
         plainto_tsquery('portuguese', $1)
       ) AS relevancia
     FROM "Chamado"
     WHERE to_tsvector('portuguese', coalesce(titulo, '') || ' ' || coalesce(descricao, '') || ' ' || coalesce(solucao, ''))
           @@ plainto_tsquery('portuguese', $1)
     ORDER BY relevancia DESC
     LIMIT 5`,
    ['impressora manchando papel']
  );
}

/**
 * Executa o benchmark de tempo e qualidade comparando:
 * 1. PostgreSQL ILIKE '%...%'
 * 2. PostgreSQL Full-Text Search (tsvector + GIN)
 * 3. pgvector SQL puro (HNSW em 5.060 vetores)
 * 4. pgvector Fim a Fim (API Gemini + SQL HNSW)
 * 5. Elasticsearch (multi_match + analisador brazilian + fuzziness + highlight)
 */
async function executarBenchmarkComparativo(): Promise<{
  estatisticas: EstatisticasTempo[];
  qualidade: ResultadoQualidadeQuery[];
  vetoresConsultaSql: string[];
}> {
  console.log('\n========================================================================================');
  console.log(
    `3. BENCHMARK DE TEMPO DE BUSCA (${PERGUNTAS_BENCHMARK.length} QUERIES × ${ITERACOES_POR_QUERY} ITERAÇÕES = ${
      PERGUNTAS_BENCHMARK.length * ITERACOES_POR_QUERY
    } EXECUÇÕES/MOTOR)`
  );
  console.log('========================================================================================');

  // 1. Pré-computar (e medir) a geração de embeddings de consulta na API Gemini
  const temposGeminiApiMs: number[] = [];
  const vetoresPorPergunta: number[][] = [];
  const vetoresSqlPorPergunta: string[] = [];

  for (let i = 0; i < PERGUNTAS_BENCHMARK.length; i++) {
    const item = PERGUNTAS_BENCHMARK[i];
    const t0 = performance.now();
    try {
      const emb = await gerarEmbedding(item.pergunta, 'RETRIEVAL_QUERY');
      const dt = performance.now() - t0;
      temposGeminiApiMs.push(dt);
      vetoresPorPergunta.push(emb);
      vetoresSqlPorPergunta.push(String(pgvector.toSql(emb)));
    } catch (erro) {
      console.warn(
        `⚠️ Fallback local de embedding para a query "${item.pergunta}" (API indisponível ou sem cota):`,
        erro instanceof Error ? erro.message : String(erro)
      );
      const embFallback = gerarVetorUnitarioSintetico(999000 + i);
      vetoresPorPergunta.push(embFallback);
      vetoresSqlPorPergunta.push(String(pgvector.toSql(embFallback)));
    }
  }

  // Warm-up das conexões e caches de página
  await prisma.chamado.findFirst();
  await buscarPorTextoElastic({ query: 'impressora', k: 5 });
  await pool.query(
    `SELECT id FROM "Documentos" ORDER BY embedding <=> $1::vector LIMIT 5`,
    [vetoresSqlPorPergunta[0]]
  );

  const temposIlikeMs: number[] = [];
  const temposFtsGinMs: number[] = [];
  const temposPgvectorSqlMs: number[] = [];
  const temposPgvectorFimAFimMs: number[] = [];
  const temposElasticMs: number[] = [];

  const qualidade: ResultadoQualidadeQuery[] = [];

  for (let qIdx = 0; qIdx < PERGUNTAS_BENCHMARK.length; qIdx++) {
    const { pergunta, termoIlike, cenario } = PERGUNTAS_BENCHMARK[qIdx];
    const vetorMemoria = vetoresPorPergunta[qIdx];
    const padraoIlike = `%${termoIlike}%`;
    const latenciaBaseGemini =
      temposGeminiApiMs[qIdx] ??
      (temposGeminiApiMs.length > 0
        ? temposGeminiApiMs.reduce((a, b) => a + b, 0) / temposGeminiApiMs.length
        : 220);

    let ultimoIlikeRows: Array<{ id: number; titulo: string }> = [];
    let ultimoFtsRows: Array<{ id: number; titulo: string; relevancia: number }> = [];
    let ultimoElasticResp: Awaited<ReturnType<typeof buscarPorTextoElastic>> | null = null;
    let ultimoPgvectorRows: Awaited<ReturnType<typeof buscarSimilares>> = [];

    for (let iter = 0; iter < ITERACOES_POR_QUERY; iter++) {
      // 1) PostgreSQL ILIKE '%...%'
      const tIlike0 = performance.now();
      const resIlike = await pool.query<{ id: number; titulo: string }>(
        `SELECT id, titulo
         FROM "Chamado"
         WHERE titulo ILIKE $1
            OR descricao ILIKE $1
            OR solucao ILIKE $1
         ORDER BY criado_em DESC
         LIMIT 5`,
        [padraoIlike]
      );
      temposIlikeMs.push(performance.now() - tIlike0);
      ultimoIlikeRows = resIlike.rows;

      // 2) PostgreSQL Full-Text Search (tsvector + GIN)
      const tFts0 = performance.now();
      const resFts = await pool.query<{
        id: number;
        titulo: string;
        relevancia: number;
      }>(
        `SELECT
           id,
           titulo,
           ts_rank(
             to_tsvector('portuguese', coalesce(titulo, '') || ' ' || coalesce(descricao, '') || ' ' || coalesce(solucao, '')),
             plainto_tsquery('portuguese', $1)
           ) AS relevancia
         FROM "Chamado"
         WHERE to_tsvector('portuguese', coalesce(titulo, '') || ' ' || coalesce(descricao, '') || ' ' || coalesce(solucao, ''))
               @@ plainto_tsquery('portuguese', $1)
         ORDER BY relevancia DESC
         LIMIT 5`,
        [pergunta]
      );
      temposFtsGinMs.push(performance.now() - tFts0);
      ultimoFtsRows = resFts.rows;

      // 3) pgvector (HNSW no PostgreSQL — isolando o tempo de consulta vetorial no banco em 5060 vetores)
      const tPgv0 = performance.now();
      const resPgv = await buscarSimilares(pergunta, 5, {
        apenasChamados: true,
        limiar: LIMIAR_SIMILARIDADE_PADRAO,
        geradorEmbedding: async () => vetorMemoria,
      });
      const dtPgvSql = performance.now() - tPgv0;
      temposPgvectorSqlMs.push(dtPgvSql);
      temposPgvectorFimAFimMs.push(latenciaBaseGemini + dtPgvSql);
      ultimoPgvectorRows = resPgv;

      // 4) Elasticsearch (multi_match + brazilian + fuzziness + highlight)
      const tEs0 = performance.now();
      const resEs = await buscarPorTextoElastic({
        query: pergunta,
        k: 5,
      });
      temposElasticMs.push(performance.now() - tEs0);
      ultimoElasticResp = resEs;
    }

    qualidade.push({
      pergunta,
      cenario,
      ilikeTotal: ultimoIlikeRows.length,
      ilikeTop1: ultimoIlikeRows[0]?.titulo ?? '(nenhum)',
      ftsGinTotal: ultimoFtsRows.length,
      ftsGinTop1: ultimoFtsRows[0]?.titulo ?? '(nenhum)',
      elasticTotal: ultimoElasticResp?.total ?? 0,
      elasticTop1:
        ultimoElasticResp?.resultados[0]?.documento.titulo ?? '(nenhum)',
      pgvectorTotal: ultimoPgvectorRows.length,
      pgvectorTop1:
        ultimoPgvectorRows[0]?.chamado?.titulo ??
        ultimoPgvectorRows[0]?.metadata.titulo ??
        '(nenhum)',
      pgvectorSimilaridadeTop1:
        ultimoPgvectorRows[0] !== undefined
          ? Number(ultimoPgvectorRows[0].similaridade.toFixed(4))
          : null,
    });
  }

  const estatisticas: EstatisticasTempo[] = [
    calcularEstatisticas(
      '1. PostgreSQL ILIKE \'%...%\' (Seq Scan)',
      temposIlikeMs
    ),
    calcularEstatisticas(
      '2. PostgreSQL Full-Text (tsvector + GIN)',
      temposFtsGinMs
    ),
    calcularEstatisticas(
      '3. pgvector SQL (Índice HNSW — 5.060 vetores)',
      temposPgvectorSqlMs
    ),
    calcularEstatisticas(
      '4. Elasticsearch (multi_match + fuzziness)',
      temposElasticMs
    ),
    calcularEstatisticas(
      '5. pgvector Fim a Fim (API Gemini + HNSW)',
      temposPgvectorFimAFimMs
    ),
  ];

  console.log('\n⏱️ Tabela Comparativa de Latência (em milissegundos):');
  console.table(estatisticas);

  console.log('\n🎯 Comparação de Qualidade / Relevância por Cenário de Busca:');
  console.table(
    qualidade.map((q) => ({
      Cenario: q.cenario,
      ILIKE_Hits: q.ilikeTotal,
      FTS_GIN_Hits: q.ftsGinTotal,
      Elastic_Hits: q.elasticTotal,
      pgvector_Hits: q.pgvectorTotal,
      pgvector_SimTop1: q.pgvectorSimilaridadeTop1 ?? '-',
      Top1_pgvector: q.pgvectorTop1.substring(0, 48),
      Top1_Elastic: q.elasticTop1.substring(0, 48),
    }))
  );

  return {
    estatisticas,
    qualidade,
    vetoresConsultaSql: vetoresSqlPorPergunta,
  };
}

async function main(): Promise<void> {
  await prepararAmbiente5000Registros();
  await listarIndicesAtivos();

  const { vetoresConsultaSql } = await executarBenchmarkComparativo();
  await demonstrarExplainAnalyze(vetoresConsultaSql[0]);

  console.log('\n✅ Benchmark e análise EXPLAIN ANALYZE finalizados com sucesso!');
}

main()
  .catch((erro: unknown) => {
    console.error('❌ Erro ao executar benchmark:', erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([
      elasticClient.close(),
      prisma.$disconnect(),
      encerrarPool(),
    ]);
  });
