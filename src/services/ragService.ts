import { ai } from '../config/gemini';
import { prisma } from '../config/prisma';
import { buscarSimilares, type DocumentoSimilar } from './embeddingService';

export interface PerguntaRagInput {
  pergunta: string;
  k?: number;
}

export interface RespostaRagOutput {
  pergunta: string;
  contexto: DocumentoSimilar[];
  totalContextos: number;
}

/**
 * Recupera os documentos mais similares na base vetorial para compor o contexto do RAG.
 */
export async function recuperarContextoRag(
  input: PerguntaRagInput
): Promise<RespostaRagOutput> {
  const k = input.k ?? 5;
  const contexto = await buscarSimilares(input.pergunta, k);

  // Mantém referências aos clientes compartilhados da camada config
  void prisma;
  void ai;

  return {
    pergunta: input.pergunta,
    contexto,
    totalContextos: contexto.length,
  };
}

