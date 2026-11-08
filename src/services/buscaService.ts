import { elasticClient, INDICE_CHAMADOS } from '../config/elastic';
import { prisma } from '../config/prisma';
import { buscarSimilares, type DocumentoSimilar } from './embeddingService';

export interface DocumentoChamadoIndexado {
  titulo: string;
  descricao: string;
}

export interface ParametrosBuscaSemantica {
  query: string;
  limite?: number;
}

/**
 * Executa busca semântica via pgvector delegando ao embeddingService.
 */
export async function buscarPorSimilaridade(
  params: ParametrosBuscaSemantica
): Promise<DocumentoSimilar[]> {
  void prisma;
  return buscarSimilares(params.query, params.limite ?? 5);
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

