import { elasticClient, INDICE_CHAMADOS } from '../config/elastic';
import { LIMIAR_SIMILARIDADE_PADRAO } from '../config/gemini';
import {
  PrioridadeChamado,
  prisma,
  StatusChamado,
} from '../config/prisma';
import {
  buscarSimilares,
  type DocumentoSimilar,
  type GeradorEmbeddingFn,
} from './embeddingService';

export interface DocumentoChamadoIndexado {
  id?: number;
  titulo: string;
  descricao: string;
  solucao?: string | null;
  status?: StatusChamado;
  prioridade?: PrioridadeChamado;
  categoriaId?: number;
  categoriaNome?: string;
  tags?: string[];
  criadoEm?: string;
  resolvidoEm?: string | null;
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

export interface ParametrosBuscaTexto {
  query: string;
  k?: number;
  status?: StatusChamado;
  categoriaId?: number;
}

export interface HitBuscaTextoElastic {
  id: number;
  score: number;
  documento: DocumentoChamadoIndexado;
  highlight: {
    titulo?: string[];
    descricao?: string[];
    solucao?: string[];
  };
}

export interface ResultadoBuscaTexto {
  query: string;
  k: number;
  total: number;
  tempoMs: number;
  resultados: HitBuscaTextoElastic[];
}

export interface ResumoSincronizacaoElastic {
  indice: string;
  totalLidos: number;
  totalIndexados: number;
  erros: number;
  tempoMs: number;
}

export interface ResultadoComparacaoBuscas {
  pergunta: string;
  k: number;
  ilikePostgres: {
    tempoMs: number;
    total: number;
    resultados: Array<{
      id: number;
      titulo: string;
      status: StatusChamado;
      categoriaNome: string;
      solucao: string | null;
    }>;
  };
  elasticsearch: {
    tempoMs: number;
    total: number;
    resultados: Array<{
      id: number;
      score: number;
      titulo: string;
      status?: StatusChamado;
      categoriaNome?: string;
      highlight: HitBuscaTextoElastic['highlight'];
    }>;
  };
  semanticaPgvector: {
    tempoMs: number;
    total: number;
    resultados: Array<{
      id: number;
      chamadoId: number | null;
      similaridade: number;
      titulo: string;
      status: StatusChamado | null;
      categoriaNome: string | null;
    }>;
  };
}

let indiceVerificadoEmMemoria = false;

/**
 * Cria o índice `chamados` no Elasticsearch com mapping explícito e analisador `brazilian`.
 */
export async function garantirIndiceChamados(
  recriar: boolean = false
): Promise<void> {
  const existe = await elasticClient.indices.exists({
    index: INDICE_CHAMADOS,
  });

  if (existe && recriar) {
    await elasticClient.indices.delete({ index: INDICE_CHAMADOS });
    indiceVerificadoEmMemoria = false;
  }

  if (!existe || recriar) {
    await elasticClient.indices.create({
      index: INDICE_CHAMADOS,
      settings: {
        analysis: {
          analyzer: {
            default: {
              type: 'brazilian',
            },
          },
        },
      },
      mappings: {
        properties: {
          id: { type: 'integer' },
          titulo: {
            type: 'text',
            analyzer: 'brazilian',
            fields: {
              keyword: { type: 'keyword', ignore_above: 256 },
            },
          },
          descricao: {
            type: 'text',
            analyzer: 'brazilian',
          },
          solucao: {
            type: 'text',
            analyzer: 'brazilian',
          },
          status: { type: 'keyword' },
          prioridade: { type: 'keyword' },
          categoriaId: { type: 'integer' },
          categoriaNome: {
            type: 'text',
            analyzer: 'brazilian',
            fields: {
              keyword: { type: 'keyword', ignore_above: 128 },
            },
          },
          tags: { type: 'keyword' },
          criadoEm: { type: 'date' },
          resolvidoEm: { type: 'date' },
        },
      },
    });
  }

  indiceVerificadoEmMemoria = true;
}

/**
 * Sincroniza (indexa/atualiza) um único chamado do PostgreSQL no Elasticsearch.
 */
export async function sincronizarChamadoNoElastic(
  chamadoId: number
): Promise<void> {
  if (!indiceVerificadoEmMemoria) {
    await garantirIndiceChamados(false);
  }

  const chamado = await prisma.chamado.findUnique({
    where: { id: chamadoId },
    include: {
      categoria: true,
      tags: {
        include: { tag: true },
      },
    },
  });

  if (!chamado) {
    return;
  }

  const documento: DocumentoChamadoIndexado = {
    id: chamado.id,
    titulo: chamado.titulo,
    descricao: chamado.descricao,
    solucao: chamado.solucao,
    status: chamado.status,
    prioridade: chamado.prioridade,
    categoriaId: chamado.categoriaId,
    categoriaNome: chamado.categoria.nome,
    tags: chamado.tags.map((ct) => ct.tag.nome),
    criadoEm: chamado.criadoEm.toISOString(),
    resolvidoEm: chamado.resolvidoEm ? chamado.resolvidoEm.toISOString() : null,
  };

  await elasticClient.index({
    index: INDICE_CHAMADOS,
    id: String(chamado.id),
    document: documento,
    refresh: 'wait_for',
  });
}

/**
 * Sincroniza em massa (bulk) todos os chamados do PostgreSQL para o Elasticsearch.
 */
export async function sincronizarTodosChamadosBulk(opcoes?: {
  recriarIndice?: boolean;
  tamanhoLote?: number;
}): Promise<ResumoSincronizacaoElastic> {
  const inicio = performance.now();
  const recriarIndice = opcoes?.recriarIndice ?? true;
  const tamanhoLote = opcoes?.tamanhoLote ?? 1000;

  await garantirIndiceChamados(recriarIndice);

  let ultimoId = 0;
  let totalLidos = 0;
  let totalIndexados = 0;
  let erros = 0;

  while (true) {
    const loteChamados = await prisma.chamado.findMany({
      where: { id: { gt: ultimoId } },
      take: tamanhoLote,
      orderBy: { id: 'asc' },
      include: {
        categoria: true,
        tags: {
          include: { tag: true },
        },
      },
    });

    if (loteChamados.length === 0) {
      break;
    }

    totalLidos += loteChamados.length;
    ultimoId = loteChamados[loteChamados.length - 1].id;

    const operations = loteChamados.flatMap((c) => {
      const doc: DocumentoChamadoIndexado = {
        id: c.id,
        titulo: c.titulo,
        descricao: c.descricao,
        solucao: c.solucao,
        status: c.status,
        prioridade: c.prioridade,
        categoriaId: c.categoriaId,
        categoriaNome: c.categoria.nome,
        tags: c.tags.map((ct) => ct.tag.nome),
        criadoEm: c.criadoEm.toISOString(),
        resolvidoEm: c.resolvidoEm ? c.resolvidoEm.toISOString() : null,
      };

      return [{ index: { _index: INDICE_CHAMADOS, _id: String(c.id) } }, doc];
    });

    const bulkResponse = await elasticClient.bulk({
      refresh: false,
      operations,
    });

    if (bulkResponse.errors) {
      for (const item of bulkResponse.items) {
        if (item.index?.error) {
          erros++;
        } else {
          totalIndexados++;
        }
      }
    } else {
      totalIndexados += loteChamados.length;
    }

    console.log(
      `📤 Bulk Elasticsearch: ${totalIndexados}/${totalLidos} chamados sincronizados...`
    );
  }

  await elasticClient.indices.refresh({ index: INDICE_CHAMADOS });

  const tempoMs = Math.round(performance.now() - inicio);
  return {
    indice: INDICE_CHAMADOS,
    totalLidos,
    totalIndexados,
    erros,
    tempoMs,
  };
}

/**
 * Busca full-text no Elasticsearch usando `multi_match`, `fuzziness: 'AUTO'` e `highlight`.
 */
export async function buscarPorTextoElastic(
  params: ParametrosBuscaTexto
): Promise<ResultadoBuscaTexto> {
  const inicio = performance.now();
  const k = params.k ?? 5;

  if (!indiceVerificadoEmMemoria) {
    await garantirIndiceChamados(false);
  }

  const filtrosElastic: Array<Record<string, unknown>> = [];
  if (params.status) {
    filtrosElastic.push({ term: { status: params.status } });
  }
  if (params.categoriaId !== undefined) {
    filtrosElastic.push({ term: { categoriaId: params.categoriaId } });
  }

  const response = await elasticClient.search<DocumentoChamadoIndexado>({
    index: INDICE_CHAMADOS,
    size: k,
    query: {
      bool: {
        must: [
          {
            multi_match: {
              query: params.query,
              fields: ['titulo^3', 'solucao^2', 'descricao', 'categoriaNome'],
              fuzziness: 'AUTO',
              operator: 'or',
            },
          },
        ],
        ...(filtrosElastic.length > 0 ? { filter: filtrosElastic } : {}),
      },
    },
    highlight: {
      pre_tags: ['<mark>'],
      post_tags: ['</mark>'],
      fields: {
        titulo: {},
        descricao: {},
        solucao: {},
      },
    },
  });

  const tempoMs = Math.round(performance.now() - inicio);
  const hits = response.hits.hits;

  const resultados: HitBuscaTextoElastic[] = hits
    .filter((hit) => hit._source !== undefined)
    .map((hit) => {
      const source = hit._source as DocumentoChamadoIndexado;
      return {
        id: source.id ?? Number(hit._id),
        score: Number(hit._score ?? 0),
        documento: source,
        highlight: {
          ...(hit.highlight?.titulo ? { titulo: hit.highlight.titulo } : {}),
          ...(hit.highlight?.descricao
            ? { descricao: hit.highlight.descricao }
            : {}),
          ...(hit.highlight?.solucao ? { solucao: hit.highlight.solucao } : {}),
        },
      };
    });

  const totalHits =
    typeof response.hits.total === 'number'
      ? response.hits.total
      : (response.hits.total?.value ?? resultados.length);

  return {
    query: params.query,
    k,
    total: totalHits,
    tempoMs,
    resultados,
  };
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
 * Compara a busca por palavra-chave (SQL ILIKE e Elasticsearch multi_match/fuzziness)
 * contra a busca semântica (pgvector) para a mesma pergunta.
 */
export async function compararBuscas(
  pergunta: string,
  k: number = 5
): Promise<ResultadoComparacaoBuscas> {
  // 1. Busca SQL com ILIKE no PostgreSQL
  const inicioIlike = performance.now();
  const termoLimpo = pergunta.trim();
  const chamadosIlike = await prisma.chamado.findMany({
    where: {
      OR: [
        { titulo: { contains: termoLimpo, mode: 'insensitive' } },
        { descricao: { contains: termoLimpo, mode: 'insensitive' } },
        { solucao: { contains: termoLimpo, mode: 'insensitive' } },
      ],
    },
    take: k,
    orderBy: { criadoEm: 'desc' },
    include: { categoria: true },
  });
  const tempoIlikeMs = Math.round(performance.now() - inicioIlike);

  // 2. Busca Full-Text no Elasticsearch (multi_match + brazilian + fuzziness)
  const resultadoElastic = await buscarPorTextoElastic({
    query: pergunta,
    k,
  });

  // 3. Busca Semântica no pgvector (cosseno)
  const inicioSemantica = performance.now();
  const resultadoSemantica = await buscarPorSimilaridade({
    query: pergunta,
    k,
    apenasChamados: true,
  });
  const tempoSemanticaMs = Math.round(performance.now() - inicioSemantica);

  return {
    pergunta,
    k,
    ilikePostgres: {
      tempoMs: tempoIlikeMs,
      total: chamadosIlike.length,
      resultados: chamadosIlike.map((c) => ({
        id: c.id,
        titulo: c.titulo,
        status: c.status,
        categoriaNome: c.categoria.nome,
        solucao: c.solucao,
      })),
    },
    elasticsearch: {
      tempoMs: resultadoElastic.tempoMs,
      total: resultadoElastic.total,
      resultados: resultadoElastic.resultados.map((r) => ({
        id: r.id,
        score: r.score,
        titulo: r.documento.titulo,
        status: r.documento.status,
        categoriaNome: r.documento.categoriaNome,
        highlight: r.highlight,
      })),
    },
    semanticaPgvector: {
      tempoMs: tempoSemanticaMs,
      total: resultadoSemantica.total,
      resultados: resultadoSemantica.resultados.map((r) => ({
        id: r.id,
        chamadoId: r.chamado_id,
        similaridade: Number(r.similaridade.toFixed(4)),
        titulo: r.chamado?.titulo ?? r.metadata.titulo ?? '',
        status: r.chamado?.status ?? null,
        categoriaNome: r.chamado?.categoriaNome ?? r.metadata.categoria ?? null,
      })),
    },
  };
}

/**
 * Indexa um documento de chamado avulso no Elasticsearch.
 */
export async function indexarChamadoNoElastic(
  id: string,
  documento: DocumentoChamadoIndexado
): Promise<string> {
  if (!indiceVerificadoEmMemoria) {
    await garantirIndiceChamados(false);
  }

  const resposta = await elasticClient.index({
    index: INDICE_CHAMADOS,
    id,
    document: documento,
    refresh: 'wait_for',
  });

  return resposta.result;
}
