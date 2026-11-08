import { prisma } from '../config/prisma';
import { buscarPorSimilaridade } from '../services/buscaService';
import type { DocumentoSimilar } from '../services/embeddingService';
import { recuperarContextoRag, type RespostaRagOutput } from '../services/ragService';

export interface BuscaSemanticaQuery {
  q: string;
  k?: number;
}

export interface BuscaSemanticaResponse {
  resultados: DocumentoSimilar[];
}

export async function handleBuscaSemantica(
  query: BuscaSemanticaQuery
): Promise<BuscaSemanticaResponse> {
  void prisma;
  const resultados = await buscarPorSimilaridade({
    query: query.q,
    limite: query.k ?? 5,
  });
  return { resultados };
}

export async function handlePerguntaRag(
  query: BuscaSemanticaQuery
): Promise<RespostaRagOutput> {
  return recuperarContextoRag({
    pergunta: query.q,
    k: query.k ?? 5,
  });
}

