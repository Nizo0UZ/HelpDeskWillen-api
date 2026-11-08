// src/services/embeddingService.ts
// Utilitário para gerar e armazenar embeddings no PostgreSQL via pgvector.
// Usa a API do Google Gemini (gratuita) para gerar os embeddings.

import pgvector from 'pgvector/pg';
import { ai, EMBEDDING_DIMENSOES, EMBEDDING_MODEL } from '../config/gemini';
import { clienteComVetor, encerrarPool } from '../config/pg';

export interface DocumentoMetadata {
  chamado_id?: number;
  artigo_id?: number;
  categoria?: string;
  origem?: string;
  [chave: string]: string | number | boolean | null | undefined;
}

export interface DocumentoSimilar {
  id: number;
  conteudo: string;
  metadata: DocumentoMetadata;
  similaridade: number;
}

interface InsercaoRow {
  id: number;
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

  try {
    const { rows } = await client.query<InsercaoRow>(
      `INSERT INTO "Documentos" (conteudo, metadata, embedding)
             VALUES ($1, $2, $3)
             RETURNING id`,
      [conteudo, JSON.stringify(metadata), pgvector.toSql(embedding)]
    );
    const id = rows[0].id;
    console.log(`✅ Documento inserido — id: ${id}`);
    return id;
  } finally {
    client.release();
  }
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
  await encerrarPool();
}

// ---------------------------------------------------------------------------
// Exemplo de uso (executado apenas quando rodado diretamente)
// ---------------------------------------------------------------------------
if (require.main === module) {
  (async (): Promise<void> => {
    try {
      // --- Inserção ---
      await inserirDocumento(
        'Como faço para resetar minha senha de acesso ao sistema?',
        { categoria: 'Acesso', origem: 'base_de_conhecimento' }
      );
      await inserirDocumento(
        'Meu computador não está conectando à rede Wi-Fi da empresa.',
        { categoria: 'Rede', origem: 'base_de_conhecimento' }
      );

      // --- Busca por similaridade ---
      console.log('\n🔍 Buscando documentos similares a "esqueci minha senha"...\n');
      const resultados = await buscarSimilares('esqueci minha senha', 3);

      console.table(
        resultados.map((r: DocumentoSimilar) => ({
          id: r.id,
          similaridade: Number(r.similaridade).toFixed(4),
          conteudo: r.conteudo.substring(0, 70),
        }))
      );
    } catch (err: unknown) {
      const mensagem = err instanceof Error ? err.message : String(err);
      console.error('❌ Erro:', mensagem);
    } finally {
      await encerrar();
    }
  })();
}

