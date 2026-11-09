import { elasticClient, INDICE_CHAMADOS } from '../config/elastic';
import { LIMIAR_SIMILARIDADE_PADRAO } from '../config/gemini';
import type { StatusChamado } from '../config/prisma';
import {
  buscarSimilares,
  type DocumentoSimilar,
  type GeradorEmbeddingFn,
} from './embeddingService';

export interface DocumentoChamadoIndexado {
  titulo: string;
  descricao: string;
}

export interface ParametrosBuscaSemantica {
  query: string;
  k?: number;
  status?: StatusChamado;
  categoria?: string | number;
  categoriaId?: number;
  limiar?: number;
  apenasChamados?: boolean;
  geradorEmbedding?: GeradorEmbeddingFn;
}

export interface ResultadoBuscaSemantica {
  query: string;
  k: number;
  limiar: number;
  filtros: {
    status: StatusChamado | null;
    categoria: string | number | null;
  };
  total: number;
  resultados: DocumentoSimilar[];
}

/**
 * Executa busca semântica via pgvector combinada com filtros relacionais (status, categoria)
 * e limiar mínimo de similaridade.
 */
export async function buscarPorSimilaridade(
  params: ParametrosBuscaSemantica
): Promise<ResultadoBuscaSemantica> {
  const k = params.k ?? 5;
  const limiar = params.limiar ?? LIMIAR_SIMILARIDADE_PADRAO;
  const apenasChamados = params.apenasChamados ?? true;

  const resultados = await buscarSimilares(params.query, k, {
    status: params.status,
    categoria: params.categoria,
    categoriaId: params.categoriaId,
    limiar,
    apenasChamados,
    geradorEmbedding: params.geradorEmbedding,
  });

  return {
    query: params.query,
    k,
    limiar,
    filtros: {
      status: params.status ?? null,
      categoria: params.categoriaId ?? params.categoria ?? null,
    },
    total: resultados.length,
    resultados,
  };
}

/**
 * Indexa um documento de chamado no Elasticsearch.
 */
export async function indexarChamadoNoElastic(
  id: string,
  documento: DocumentoChamadoIndexado
): Promise<string> {
  const resposta = await elasticClient.index({
    index: INDICE_CHAMADOS,
    id,
    document: documento,
    refresh: 'wait_for',
  });

  return resposta.result;
}
