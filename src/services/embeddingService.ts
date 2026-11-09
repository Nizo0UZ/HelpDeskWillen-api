// src/services/embeddingService.ts
// Serviço para gerar e armazenar embeddings no PostgreSQL via pgvector.
// Usa a API do Google Gemini (gratuita) para gerar os embeddings individuais e em lote (batchEmbedContents).

import pgvector from 'pgvector/pg';
import { ai, EMBEDDING_DIMENSOES, EMBEDDING_MODEL } from '../config/gemini';
import { clienteComVetor, encerrarPool } from '../config/pg';
import { prisma, StatusChamado } from '../config/prisma';

export interface DocumentoMetadata {
  chamado_id?: number;
  artigo_id?: number;
  categoria?: string;
  origem?: string;
  titulo?: string;
  [chave: string]: string | number | boolean | null | undefined;
}

export interface DocumentoSimilar {
  id: number;
  conteudo: string;
  metadata: DocumentoMetadata;
  chamado_id: number | null;
  artigo_id: number | null;
  similaridade: number;
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

function aguardar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Funções exportáveis
// ---------------------------------------------------------------------------

/**
 * Gera um embedding para o texto fornecido usando Google Gemini.
 * @param texto Texto de entrada
 * @returns Array de 1536 floats (gemini-embedding-001)
 */
export async function gerarEmbedding(texto: string): Promise<number[]> {
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: texto.trim(),
    config: { outputDimensionality: EMBEDDING_DIMENSOES },
  });

  const valores = response.embeddings?.[0]?.values;
  if (!valores) {
    throw new Error('A API do Gemini não retornou valores de embedding.');
  }

  return valores;
}

/**
 * Gera embeddings para múltiplos textos em uma única chamada (:batchEmbedContents)
 * com tratamento de rate-limit (HTTP 429) para respeitar a cota gratuita do Gemini.
 */
export async function gerarEmbeddingsEmLote(
  textos: string[],
  maxTentativas: number = 3
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
        config: { outputDimensionality: EMBEDDING_DIMENSOES },
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
 * Insere um documento com seu embedding na tabela "Documentos".
 * @param conteudo Texto que será indexado
 * @param metadata Dados extras (ex.: { chamado_id: 1, categoria: 'Rede' })
 * @returns ID do registro inserido
 */
export async function inserirDocumento(
  conteudo: string,
  metadata: DocumentoMetadata = {}
): Promise<number> {
  const embedding = await gerarEmbedding(conteudo);
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
 * Insere múltiplos documentos em lotes usando batchEmbedContents e um pequeno delay
 * entre cada lote para respeitar a cota gratuita do Gemini.
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

      const embeddings = await gerarEmbeddingsEmLote(textos, maxTentativas);

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
 * Respeita um limite de chamados para não estourar a cota gratuita do Gemini.
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
 * Busca os K documentos mais similares à query usando distância de cosseno.
 * @param query Texto de busca
 * @param k Número máximo de resultados (padrão: 5)
 * @returns Lista de documentos similares ordenados pela menor distância de cosseno
 */
export async function buscarSimilares(
  query: string,
  k: number = 5
): Promise<DocumentoSimilar[]> {
  const embedding = await gerarEmbedding(query);
  const client = await clienteComVetor();

  try {
    const { rows } = await client.query<DocumentoSimilar>(
      `SELECT
          id,
          conteudo,
          metadata,
          chamado_id,
          artigo_id,
          -- 1 - distância_de_cosseno = similaridade (0 a 1)
          (1 - (embedding <=> $1))::FLOAT AS similaridade
       FROM "Documentos"
       ORDER BY embedding <=> $1   -- operador cosine distance do pgvector
       LIMIT $2`,
      [pgvector.toSql(embedding), k]
    );
    return rows;
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
