// src/services/embeddingService.ts
// Serviço para gerar e armazenar embeddings no PostgreSQL via pgvector.
// Usa a API do Google Gemini para gerar embeddings com taskType específico
// (RETRIEVAL_DOCUMENT para indexação e RETRIEVAL_QUERY para busca).

import pgvector from 'pgvector/pg';
import {
  ai,
  EMBEDDING_DIMENSOES,
  EMBEDDING_MODEL,
  LIMIAR_SIMILARIDADE_PADRAO,
} from '../config/gemini';
import { clienteComVetor, encerrarPool } from '../config/pg';
import {
  PrioridadeChamado,
  Prisma,
  prisma,
  StatusChamado,
} from '../config/prisma';

export type TipoTarefaEmbedding = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

export type GeradorEmbeddingFn = (
  texto: string,
  taskType?: TipoTarefaEmbedding
) => Promise<number[]>;

export interface DadosChamadoParaEmbedding {
  id: number;
  titulo: string;
  descricao: string;
  solucao?: string | null;
  categoriaNome?: string;
}

export interface DocumentoMetadata {
  chamado_id?: number;
  artigo_id?: number;
  categoria?: string;
  origem?: string;
  titulo?: string;
  [chave: string]: string | number | boolean | null | undefined;
}

export interface ChamadoRelacionadoBusca {
  id: number;
  titulo: string;
  descricao: string;
  status: StatusChamado;
  prioridade: PrioridadeChamado;
  solucao: string | null;
  resolvidoEm: Date | null;
  categoriaId: number;
  categoriaNome: string;
}

export interface ArtigoRelacionadoBusca {
  id: number;
  titulo: string;
  conteudo: string;
  categoriaId: number;
  categoriaNome: string;
}

export interface DocumentoSimilar {
  id: number;
  conteudo: string;
  metadata: DocumentoMetadata;
  chamado_id: number | null;
  artigo_id: number | null;
  similaridade: number;
  chamado: ChamadoRelacionadoBusca | null;
  artigo: ArtigoRelacionadoBusca | null;
}

export interface FiltrosBuscaSemantica {
  status?: StatusChamado;
  categoria?: string | number;
  categoriaId?: number;
  limiar?: number;
  apenasChamados?: boolean;
  geradorEmbedding?: GeradorEmbeddingFn;
}

export interface NovoDocumentoInput {
  conteudo: string;
  metadata?: DocumentoMetadata;
  chamadoId?: number | null;
  artigoId?: number | null;
}

export interface OpcoesIndexacaoLote {
  tamanhoLote?: number;
  delayMs?: number;
  maxTentativas?: number;
}

export interface OpcoesReindexacao extends OpcoesIndexacaoLote {
  limiteChamados?: number;
  limiteArtigos?: number;
  limparAntes?: boolean;
}

export interface ResumoReindexacao {
  artigosIndexados: number;
  chamadosIndexados: number;
  totalDocumentos: number;
}

interface InsercaoRow {
  id: number;
}

interface BuscaSimilarQueryRow {
  id: number;
  conteudo: string;
  metadata: DocumentoMetadata;
  chamado_id: number | null;
  artigo_id: number | null;
  similaridade: number;
  chamado_titulo: string | null;
  chamado_descricao: string | null;
  chamado_status: StatusChamado | null;
  chamado_prioridade: PrioridadeChamado | null;
  chamado_solucao: string | null;
  chamado_resolvido_em: Date | null;
  chamado_categoria_id: number | null;
  chamado_categoria_nome: string | null;
  artigo_titulo: string | null;
  artigo_conteudo: string | null;
  artigo_categoria_id: number | null;
  artigo_categoria_nome: string | null;
}

function aguardar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Funções exportáveis
// ---------------------------------------------------------------------------

/**
 * Gera um embedding para o texto fornecido usando Google Gemini.
 * @param texto Texto de entrada
 * @param taskType RETRIEVAL_DOCUMENT para indexar documentos; RETRIEVAL_QUERY para consultas
 * @returns Array de 1536 floats (gemini-embedding-001)
 */
export async function gerarEmbedding(
  texto: string,
  taskType: TipoTarefaEmbedding = 'RETRIEVAL_DOCUMENT'
): Promise<number[]> {
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: texto.trim(),
    config: {
      outputDimensionality: EMBEDDING_DIMENSOES,
      taskType,
    },
  });

  const valores = response.embeddings?.[0]?.values;
  if (!valores) {
    throw new Error('A API do Gemini não retornou valores de embedding.');
  }

  return valores;
}

/**
 * Gera embeddings para múltiplos textos em uma única chamada (:batchEmbedContents)
 * usando taskType = RETRIEVAL_DOCUMENT por padrão e tratando rate-limit (HTTP 429).
 */
export async function gerarEmbeddingsEmLote(
  textos: string[],
  maxTentativas: number = 3,
  taskType: TipoTarefaEmbedding = 'RETRIEVAL_DOCUMENT'
): Promise<number[][]> {
  if (textos.length === 0) {
    return [];
  }

  const textosLimpos = textos.map((t) => t.trim());

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      const response = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: textosLimpos,
        config: {
          outputDimensionality: EMBEDDING_DIMENSOES,
          taskType,
        },
      });

      const listaEmbeddings = response.embeddings;
      if (!listaEmbeddings || listaEmbeddings.length !== textosLimpos.length) {
        throw new Error(
          `Quantidade de embeddings retornada (${listaEmbeddings?.length ?? 0}) difere do lote enviado (${textosLimpos.length}).`
        );
      }

      return listaEmbeddings.map((item, idx) => {
        if (!item.values) {
          throw new Error(`Embedding vazio no índice ${idx} do lote.`);
        }
        return item.values;
      });
    } catch (erro: unknown) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      const ehRateLimit =
        mensagem.includes('429') ||
        mensagem.includes('RESOURCE_EXHAUSTED') ||
        mensagem.includes('quota');

      if (ehRateLimit && tentativa < maxTentativas) {
        const esperaMs = tentativa * 5000;
        console.warn(
          `⚠️ Limite de taxa da API Gemini atingido (tentativa ${tentativa}/${maxTentativas}). Aguardando ${esperaMs}ms...`
        );
        await aguardar(esperaMs);
        continue;
      }

      throw erro;
    }
  }

  throw new Error('Falha ao gerar embeddings em lote após múltiplas tentativas.');
}

/**
 * Insere um documento com seu embedding na tabela "Documentos" usando taskType RETRIEVAL_DOCUMENT.
 */
export async function inserirDocumento(
  conteudo: string,
  metadata: DocumentoMetadata = {}
): Promise<number> {
  const embedding = await gerarEmbedding(conteudo, 'RETRIEVAL_DOCUMENT');
  const client = await clienteComVetor();

  const chamadoId =
    typeof metadata.chamado_id === 'number' ? metadata.chamado_id : null;
  const artigoId =
    typeof metadata.artigo_id === 'number' ? metadata.artigo_id : null;

  try {
    const { rows } = await client.query<InsercaoRow>(
      `INSERT INTO "Documentos" (conteudo, metadata, embedding, chamado_id, artigo_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        conteudo,
        JSON.stringify(metadata),
        pgvector.toSql(embedding),
        chamadoId,
        artigoId,
      ]
    );
    const id = rows[0].id;
    console.log(`✅ Documento inserido — id: ${id}`);
    return id;
  } finally {
    client.release();
  }
}

/**
 * Gera e persiste (ou atualiza) o embedding de um chamado dentro de uma transação
 * interativa do Prisma (`tx`) usando taskType RETRIEVAL_DOCUMENT.
 */
export async function salvarEmbeddingChamadoTx(
  tx: Prisma.TransactionClient,
  chamado: DadosChamadoParaEmbedding,
  gerador: GeradorEmbeddingFn = gerarEmbedding
): Promise<void> {
  const partesConteudo = [
    `[CHAMADO #${chamado.id}] ${chamado.titulo}`,
    ...(chamado.categoriaNome ? [`Categoria: ${chamado.categoriaNome}`] : []),
    `Problema: ${chamado.descricao}`,
    ...(chamado.solucao ? [`Solução aplicada: ${chamado.solucao}`] : []),
  ];
  const conteudo = partesConteudo.join('\n');

  const embedding = await gerador(conteudo, 'RETRIEVAL_DOCUMENT');
  const vetorSql = pgvector.toSql(embedding);

  const metadata: DocumentoMetadata = {
    chamado_id: chamado.id,
    titulo: chamado.titulo,
    ...(chamado.categoriaNome ? { categoria: chamado.categoriaNome } : {}),
    origem: chamado.solucao ? 'chamado_resolvido' : 'chamado_aberto',
  };

  await tx.documentos.deleteMany({
    where: { chamadoId: chamado.id },
  });

  await tx.$executeRawUnsafe(
    `INSERT INTO "Documentos" (conteudo, metadata, embedding, chamado_id)
     VALUES ($1, $2::jsonb, $3::vector, $4)`,
    conteudo,
    JSON.stringify(metadata),
    vetorSql,
    chamado.id
  );
}

/**
 * Insere múltiplos documentos em lotes usando batchEmbedContents (RETRIEVAL_DOCUMENT)
 * e um pequeno delay entre cada lote para respeitar a cota gratuita do Gemini.
 */
export async function inserirDocumentosEmLote(
  documentos: NovoDocumentoInput[],
  opcoes: OpcoesIndexacaoLote = {}
): Promise<number> {
  if (documentos.length === 0) {
    return 0;
  }

  const tamanhoLote = opcoes.tamanhoLote ?? 20;
  const delayMs = opcoes.delayMs ?? 1500;
  const maxTentativas = opcoes.maxTentativas ?? 3;

  const client = await clienteComVetor();
  let totalInseridos = 0;
  const totalLotes = Math.ceil(documentos.length / tamanhoLote);

  try {
    for (let i = 0; i < documentos.length; i += tamanhoLote) {
      const numeroLote = Math.floor(i / tamanhoLote) + 1;
      const lote = documentos.slice(i, i + tamanhoLote);
      const textos = lote.map((doc) => doc.conteudo);

      const embeddings = await gerarEmbeddingsEmLote(
        textos,
        maxTentativas,
        'RETRIEVAL_DOCUMENT'
      );

      await client.query('BEGIN');
      try {
        for (let j = 0; j < lote.length; j++) {
          const item = lote[j];
          const vetor = embeddings[j];
          const metadata: DocumentoMetadata = {
            ...(item.metadata ?? {}),
            ...(item.chamadoId != null ? { chamado_id: item.chamadoId } : {}),
            ...(item.artigoId != null ? { artigo_id: item.artigoId } : {}),
          };

          await client.query(
            `INSERT INTO "Documentos" (conteudo, metadata, embedding, chamado_id, artigo_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              item.conteudo,
              JSON.stringify(metadata),
              pgvector.toSql(vetor),
              item.chamadoId ?? null,
              item.artigoId ?? null,
            ]
          );
          totalInseridos++;
        }
        await client.query('COMMIT');
      } catch (erroTransacao: unknown) {
        await client.query('ROLLBACK');
        throw erroTransacao;
      }

      console.log(
        `📦 Lote ${numeroLote}/${totalLotes} indexado (${totalInseridos}/${documentos.length} documentos)`
      );

      if (i + tamanhoLote < documentos.length && delayMs > 0) {
        await aguardar(delayMs);
      }
    }

    return totalInseridos;
  } finally {
    client.release();
  }
}

/**
 * Reindexa artigos da base de conhecimento e chamados resolvidos na tabela "Documentos".
 */
export async function reindexarBaseSemantica(
  opcoes: OpcoesReindexacao = {}
): Promise<ResumoReindexacao> {
  const limiteChamados =
    opcoes.limiteChamados ?? Number(process.env.SEED_EMBEDDING_LIMIT ?? 40);
  const limiteArtigos = opcoes.limiteArtigos ?? 20;
  const limparAntes = opcoes.limparAntes ?? true;

  if (limparAntes) {
    await prisma.documentos.deleteMany();
  }

  const [artigos, chamadosResolvidos] = await Promise.all([
    prisma.artigo.findMany({
      take: limiteArtigos,
      orderBy: { id: 'asc' },
      include: { categoria: true },
    }),
    prisma.chamado.findMany({
      where: {
        status: StatusChamado.RESOLVIDO,
        solucao: { not: null },
      },
      take: limiteChamados,
      orderBy: { id: 'asc' },
      include: { categoria: true },
    }),
  ]);

  const documentosParaIndexar: NovoDocumentoInput[] = [];

  for (const artigo of artigos) {
    const conteudoFormatado = [
      `[ARTIGO] ${artigo.titulo}`,
      `Categoria: ${artigo.categoria.nome}`,
      `Conteúdo: ${artigo.conteudo}`,
    ].join('\n');

    documentosParaIndexar.push({
      conteudo: conteudoFormatado,
      artigoId: artigo.id,
      metadata: {
        artigo_id: artigo.id,
        titulo: artigo.titulo,
        categoria: artigo.categoria.nome,
        origem: 'artigo_base_conhecimento',
      },
    });
  }

  for (const chamado of chamadosResolvidos) {
    const conteudoFormatado = [
      `[CHAMADO #${chamado.id}] ${chamado.titulo}`,
      `Categoria: ${chamado.categoria.nome}`,
      `Problema: ${chamado.descricao}`,
      `Solução aplicada: ${chamado.solucao ?? ''}`,
    ].join('\n');

    documentosParaIndexar.push({
      conteudo: conteudoFormatado,
      chamadoId: chamado.id,
      metadata: {
        chamado_id: chamado.id,
        titulo: chamado.titulo,
        categoria: chamado.categoria.nome,
        origem: 'chamado_resolvido',
      },
    });
  }

  console.log(
    `🔄 Iniciando geração de embeddings para ${artigos.length} artigos e ${chamadosResolvidos.length} chamados resolvidos...`
  );

  const totalDocumentos = await inserirDocumentosEmLote(documentosParaIndexar, {
    tamanhoLote: opcoes.tamanhoLote ?? 20,
    delayMs: opcoes.delayMs ?? 1500,
    maxTentativas: opcoes.maxTentativas ?? 3,
  });

  return {
    artigosIndexados: artigos.length,
    chamadosIndexados: chamadosResolvidos.length,
    totalDocumentos,
  };
}

/**
 * Busca os K documentos mais similares à query usando distância de cosseno (taskType = RETRIEVAL_QUERY),
 * aplicando limiar mínimo de similaridade e filtros relacionais (status do chamado, categoria)
 * diretamente no SQL via JOIN com "Chamado", "Artigo" e "Categoria".
 */
export async function buscarSimilares(
  query: string,
  k: number = 5,
  filtros: FiltrosBuscaSemantica = {}
): Promise<DocumentoSimilar[]> {
  const gerador = filtros.geradorEmbedding ?? gerarEmbedding;
  const embedding = await gerador(query, 'RETRIEVAL_QUERY');
  const client = await clienteComVetor();

  const limiar = filtros.limiar ?? LIMIAR_SIMILARIDADE_PADRAO;
  const valoresSql: unknown[] = [pgvector.toSql(embedding), k, limiar];
  const condicoesWhere: string[] = ['(1 - (d.embedding <=> $1)) >= $3'];

  if (filtros.apenasChamados) {
    condicoesWhere.push('d.chamado_id IS NOT NULL');
  }

  if (filtros.status !== undefined) {
    valoresSql.push(filtros.status);
    const idx = valoresSql.length;
    if (filtros.apenasChamados) {
      condicoesWhere.push(`c.status::text = $${idx}`);
    } else {
      condicoesWhere.push(`(d.chamado_id IS NULL OR c.status::text = $${idx})`);
    }
  }

  const filtroCategoria = filtros.categoriaId ?? filtros.categoria;
  if (filtroCategoria !== undefined && filtroCategoria !== '') {
    const numeroCat = Number(filtroCategoria);
    if (!Number.isNaN(numeroCat) && Number.isInteger(numeroCat)) {
      valoresSql.push(numeroCat);
      const idx = valoresSql.length;
      condicoesWhere.push(`COALESCE(c.categoria_id, a.categoria_id) = $${idx}`);
    } else {
      valoresSql.push(`%${String(filtroCategoria).trim()}%`);
      const idx = valoresSql.length;
      condicoesWhere.push(`COALESCE(cat_c.nome, cat_a.nome) ILIKE $${idx}`);
    }
  }

  const sql = `
    SELECT
      d.id,
      d.conteudo,
      d.metadata,
      d.chamado_id,
      d.artigo_id,
      (1 - (d.embedding <=> $1))::FLOAT AS similaridade,
      c.titulo AS chamado_titulo,
      c.descricao AS chamado_descricao,
      c.status AS chamado_status,
      c.prioridade AS chamado_prioridade,
      c.solucao AS chamado_solucao,
      c.resolvido_em AS chamado_resolvido_em,
      c.categoria_id AS chamado_categoria_id,
      cat_c.nome AS chamado_categoria_nome,
      a.titulo AS artigo_titulo,
      a.conteudo AS artigo_conteudo,
      a.categoria_id AS artigo_categoria_id,
      cat_a.nome AS artigo_categoria_nome
    FROM "Documentos" d
    LEFT JOIN "Chamado" c ON c.id = d.chamado_id
    LEFT JOIN "Categoria" cat_c ON cat_c.id = c.categoria_id
    LEFT JOIN "Artigo" a ON a.id = d.artigo_id
    LEFT JOIN "Categoria" cat_a ON cat_a.id = a.categoria_id
    WHERE ${condicoesWhere.join(' AND ')}
    ORDER BY d.embedding <=> $1
    LIMIT $2
  `;

  try {
    const { rows } = await client.query<BuscaSimilarQueryRow>(sql, valoresSql);

    return rows.map((row): DocumentoSimilar => ({
      id: row.id,
      conteudo: row.conteudo,
      metadata: row.metadata,
      chamado_id: row.chamado_id,
      artigo_id: row.artigo_id,
      similaridade: Number(row.similaridade),
      chamado:
        row.chamado_id !== null &&
        row.chamado_titulo !== null &&
        row.chamado_descricao !== null &&
        row.chamado_status !== null &&
        row.chamado_prioridade !== null &&
        row.chamado_categoria_id !== null
          ? {
              id: row.chamado_id,
              titulo: row.chamado_titulo,
              descricao: row.chamado_descricao,
              status: row.chamado_status,
              prioridade: row.chamado_prioridade,
              solucao: row.chamado_solucao,
              resolvidoEm: row.chamado_resolvido_em,
              categoriaId: row.chamado_categoria_id,
              categoriaNome: row.chamado_categoria_nome ?? '',
            }
          : null,
      artigo:
        row.artigo_id !== null &&
        row.artigo_titulo !== null &&
        row.artigo_conteudo !== null &&
        row.artigo_categoria_id !== null
          ? {
              id: row.artigo_id,
              titulo: row.artigo_titulo,
              conteudo: row.artigo_conteudo,
              categoriaId: row.artigo_categoria_id,
              categoriaNome: row.artigo_categoria_nome ?? '',
            }
          : null,
    }));
  } finally {
    client.release();
  }
}

/**
 * Encerra a pool de conexões (chamar ao final do processo).
 */
export async function encerrar(): Promise<void> {
  await Promise.allSettled([encerrarPool(), prisma.$disconnect()]);
}

// ---------------------------------------------------------------------------
// Execução direta via CLI (npm run reindex)
// ---------------------------------------------------------------------------
if (require.main === module) {
  (async (): Promise<void> => {
    try {
      const resumo = await reindexarBaseSemantica();
      console.log('✅ Reindexação concluída:', resumo);

      console.log(
        '\n🔍 Testando busca semântica para "esqueci minha senha e minha conta bloqueou"...\n'
      );
      const resultados = await buscarSimilares(
        'esqueci minha senha e minha conta bloqueou',
        3
      );

      console.table(
        resultados.map((r: DocumentoSimilar) => ({
          id: r.id,
          chamado_id: r.chamado_id,
          artigo_id: r.artigo_id,
          similaridade: Number(r.similaridade).toFixed(4),
          conteudo: r.conteudo.replace(/\s+/g, ' ').substring(0, 75),
        }))
      );
    } catch (err: unknown) {
      const mensagem = err instanceof Error ? err.message : String(err);
      console.error('❌ Erro na reindexação:', mensagem);
      process.exitCode = 1;
    } finally {
      await encerrar();
    }
  })();
}
