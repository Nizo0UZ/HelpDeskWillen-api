import {
  ai,
  GENERATION_MODELS_FALLBACK,
  LIMIAR_SIMILARIDADE_PADRAO,
} from '../config/gemini';
import { StatusChamado } from '../config/prisma';
import {
  buscarSimilares,
  type DocumentoSimilar,
  type GeradorEmbeddingFn,
} from './embeddingService';

export type GeradorTextoRagFn = (prompt: string) => Promise<string>;

export interface PerguntaRagInput {
  pergunta: string;
  k?: number;
  status?: StatusChamado;
  categoria?: string | number;
  categoriaId?: number;
  limiar?: number;
  geradorEmbedding?: GeradorEmbeddingFn;
  geradorTexto?: GeradorTextoRagFn;
}

export interface RespostaRagOutput {
  pergunta: string;
  respostaSugerida: string;
  chamadosCitadosIds: number[];
  artigosCitadosIds: number[];
  limiarAplicado: number;
  totalContextos: number;
  contexto: DocumentoSimilar[];
}

async function gerarTextoComGemini(prompt: string): Promise<string> {
  let ultimoErro: unknown;

  for (const modelo of GENERATION_MODELS_FALLBACK) {
    try {
      const response = await ai.models.generateContent({
        model: modelo,
        contents: prompt,
      });

      const texto = response.text?.trim();
      if (texto) {
        return texto;
      }
    } catch (erro: unknown) {
      ultimoErro = erro;
      const msg = erro instanceof Error ? erro.message : String(erro);
      const ehTemporario =
        msg.includes('503') ||
        msg.includes('429') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('NOT_FOUND');

      if (!ehTemporario) {
        throw erro;
      }
    }
  }

  throw ultimoErro instanceof Error
    ? ultimoErro
    : new Error('Falha ao gerar resposta com os modelos Gemini configurados.');
}

function montarPromptRag(pergunta: string, contexto: DocumentoSimilar[]): string {
  const blocosContexto = contexto.map((doc, idx) => {
    const similaridadeFormatada = doc.similaridade.toFixed(4);
    if (doc.chamado) {
      return [
        `Fonte ${idx + 1}: [Chamado #${doc.chamado.id}] (Similaridade: ${similaridadeFormatada})`,
        `Categoria: ${doc.chamado.categoriaNome}`,
        `Status: ${doc.chamado.status}`,
        `Título: ${doc.chamado.titulo}`,
        `Problema relatado: ${doc.chamado.descricao}`,
        `Solução aplicada: ${doc.chamado.solucao ?? 'Sem solução registrada'}`,
      ].join('\n');
    }

    if (doc.artigo) {
      return [
        `Fonte ${idx + 1}: [Artigo #${doc.artigo.id}] (Similaridade: ${similaridadeFormatada})`,
        `Categoria: ${doc.artigo.categoriaNome}`,
        `Título: ${doc.artigo.titulo}`,
        `Conteúdo: ${doc.artigo.conteudo}`,
      ].join('\n');
    }

    return `Fonte ${idx + 1}: [Documento #${doc.id}] (Similaridade: ${similaridadeFormatada})\n${doc.conteudo}`;
  });

  return [
    'Você é um especialista de suporte técnico de TI (Helpdesk).',
    'Sua tarefa é responder à dúvida ou problema abaixo baseando-se EXCLUSIVAMENTE nos chamados históricos e artigos da base de conhecimento fornecidos no contexto.',
    'Regras obrigatórias:',
    '1. Forneça uma resposta técnica clara, objetiva e em português.',
    '2. Cite explicitamente no texto os IDs dos chamados e/ou artigos utilizados no formato [Chamado #<id>] e/ou [Artigo #<id>].',
    '3. Não invente procedimentos que não estejam respaldados pelo contexto.',
    '',
    '--- CONTEXTO RECUPERADO DA BASE ---',
    blocosContexto.join('\n\n---\n\n'),
    '--- FIM DO CONTEXTO ---',
    '',
    `PERGUNTA / PROBLEMA ATUAL DO USUÁRIO: ${pergunta}`,
    '',
    'RESPOSTA SUGERIDA (citando os IDs):',
  ].join('\n');
}

/**
 * Executa o fluxo completo de RAG (Retrieval-Augmented Generation):
 * 1. Recupera os top-K chamados/artigos acima do limiar mínimo de similaridade (com taskType = RETRIEVAL_QUERY).
 * 2. Envia o contexto recuperado para o modelo Gemini gerar uma resposta sugerida citando os IDs usados.
 */
export async function perguntarRag(
  input: PerguntaRagInput
): Promise<RespostaRagOutput> {
  const k = input.k ?? 5;
  const limiar = input.limiar ?? LIMIAR_SIMILARIDADE_PADRAO;
  const statusFiltro = input.status ?? StatusChamado.RESOLVIDO;

  const contexto = await buscarSimilares(input.pergunta, k, {
    status: statusFiltro,
    categoria: input.categoria,
    categoriaId: input.categoriaId,
    limiar,
    apenasChamados: false,
    geradorEmbedding: input.geradorEmbedding,
  });

  if (contexto.length === 0) {
    return {
      pergunta: input.pergunta,
      respostaSugerida:
        'Não foram encontrados chamados resolvidos ou artigos na base de conhecimento com similaridade suficiente para sugerir uma solução.',
      chamadosCitadosIds: [],
      artigosCitadosIds: [],
      limiarAplicado: limiar,
      totalContextos: 0,
      contexto: [],
    };
  }

  const prompt = montarPromptRag(input.pergunta, contexto);
  const geradorTexto = input.geradorTexto ?? gerarTextoComGemini;
  const respostaSugerida = await geradorTexto(prompt);

  const chamadosCitadosIds = Array.from(
    new Set(
      contexto
        .map((doc) => doc.chamado_id)
        .filter((id): id is number => id !== null)
    )
  );

  const artigosCitadosIds = Array.from(
    new Set(
      contexto
        .map((doc) => doc.artigo_id)
        .filter((id): id is number => id !== null)
    )
  );

  return {
    pergunta: input.pergunta,
    respostaSugerida,
    chamadosCitadosIds,
    artigosCitadosIds,
    limiarAplicado: limiar,
    totalContextos: contexto.length,
    contexto,
  };
}
