import {
  PapelUsuario,
  PrioridadeChamado,
  Prisma,
  prisma,
  StatusChamado,
  type Chamado,
  type Comentario,
} from '../config/prisma';
import { ErroAplicacao } from '../middlewares/erros';
import {
  gerarEmbedding,
  salvarEmbeddingChamadoTx,
  type GeradorEmbeddingFn,
} from './embeddingService';
import { sincronizarChamadoNoElastic } from './buscaService';

export interface CriarChamadoInput {
  titulo: string;
  descricao: string;
  categoriaId: number;
  solicitanteId: number;
  atendenteId?: number | null;
  prioridade?: PrioridadeChamado;
}

export interface AtualizarStatusChamadoInput {
  status: StatusChamado;
  solucao?: string | null;
  atendenteId?: number | null;
  autorId?: number;
  comentario?: string;
}

export interface CriarComentarioInput {
  autorId: number;
  conteudo: string;
}

export interface FiltrosChamado {
  status?: StatusChamado;
  prioridade?: PrioridadeChamado;
  categoria?: string | number;
  categoriaId?: number;
  pagina?: number;
  limite?: number;
}

export interface ResultadoPaginadoChamados {
  dados: Chamado[];
  paginacao: {
    pagina: number;
    limite: number;
    total: number;
    totalPaginas: number;
  };
}

const SELECT_USUARIO_PUBLICO = {
  id: true,
  nome: true,
  email: true,
  papel: true,
  ativo: true,
  criadoEm: true,
  atualizadoEm: true,
} as const;

const INCLUDE_CHAMADO_DETALHADO = {
  categoria: true,
  solicitante: { select: SELECT_USUARIO_PUBLICO },
  atendente: { select: SELECT_USUARIO_PUBLICO },
  comentarios: {
    orderBy: { criadoEm: 'asc' as const },
    include: {
      autor: { select: SELECT_USUARIO_PUBLICO },
    },
  },
  tags: {
    include: {
      tag: true,
    },
  },
} as const;

export type ChamadoDetalhado = Prisma.ChamadoGetPayload<{
  include: typeof INCLUDE_CHAMADO_DETALHADO;
}>;

/**
 * Regra de negócio: somente um usuário existente com papel ATENDENTE pode ser atribuído como atendente.
 */
async function validarAtendenteTx(
  tx: Prisma.TransactionClient,
  atendenteId: number
): Promise<void> {
  const usuario = await tx.usuario.findUnique({
    where: { id: atendenteId },
    select: { id: true, papel: true },
  });

  if (!usuario) {
    throw new ErroAplicacao('O atendente informado não existe.', 400);
  }

  if (usuario.papel !== PapelUsuario.ATENDENTE) {
    throw new ErroAplicacao(
      'Somente um usuário com papel ATENDENTE pode ser atribuído como atendente de um chamado.',
      400
    );
  }
}

/**
 * Cria um chamado e gera seu embedding na mesma transação.
 * Se a criação ou a geração/inserção do embedding falhar, toda a operação é revertida.
 */
export async function criarChamado(
  dados: CriarChamadoInput,
  geradorEmbedding: GeradorEmbeddingFn = gerarEmbedding
): Promise<Chamado> {
  return prisma.$transaction(async (tx) => {
    if (dados.atendenteId !== undefined && dados.atendenteId !== null) {
      await validarAtendenteTx(tx, dados.atendenteId);
    }

    const novoChamado = await tx.chamado.create({
      data: {
        titulo: dados.titulo,
        descricao: dados.descricao,
        categoriaId: dados.categoriaId,
        solicitanteId: dados.solicitanteId,
        atendenteId: dados.atendenteId ?? null,
        prioridade: dados.prioridade ?? PrioridadeChamado.MEDIA,
      },
      include: {
        categoria: true,
      },
    });

    await salvarEmbeddingChamadoTx(
      tx,
      {
        id: novoChamado.id,
        titulo: novoChamado.titulo,
        descricao: novoChamado.descricao,
        solucao: novoChamado.solucao,
        categoriaNome: novoChamado.categoria.nome,
      },
      geradorEmbedding
    );

    const { categoria: _categoria, ...chamadoSemJoin } = novoChamado;
    return chamadoSemJoin;
  }).then(async (chamadoCriado) => {
    try {
      await sincronizarChamadoNoElastic(chamadoCriado.id);
    } catch (erroElastic: unknown) {
      const msg = erroElastic instanceof Error ? erroElastic.message : String(erroElastic);
      console.warn(`⚠️ Falha ao sincronizar chamado #${chamadoCriado.id} no Elasticsearch: ${msg}`);
    }
    return chamadoCriado;
  });
}

/**
 * Lista chamados com suporte a filtros por status, categoria e prioridade, além de paginação.
 */
export async function listarChamados(
  filtros: FiltrosChamado = {}
): Promise<ResultadoPaginadoChamados> {
  const pagina = Math.max(1, filtros.pagina ?? 1);
  const limite = Math.min(100, Math.max(1, filtros.limite ?? 20));
  const skip = (pagina - 1) * limite;

  const where: Prisma.ChamadoWhereInput = {};

  if (filtros.status !== undefined) {
    where.status = filtros.status;
  }

  if (filtros.prioridade !== undefined) {
    where.prioridade = filtros.prioridade;
  }

  if (filtros.categoriaId !== undefined) {
    where.categoriaId = filtros.categoriaId;
  } else if (filtros.categoria !== undefined && filtros.categoria !== '') {
    const numeroCategoria = Number(filtros.categoria);
    if (!Number.isNaN(numeroCategoria) && Number.isInteger(numeroCategoria)) {
      where.categoriaId = numeroCategoria;
    } else {
      where.categoria = {
        nome: {
          contains: String(filtros.categoria),
          mode: 'insensitive',
        },
      };
    }
  }

  const [dados, total] = await prisma.$transaction([
    prisma.chamado.findMany({
      where,
      skip,
      take: limite,
      orderBy: { criadoEm: 'desc' },
    }),
    prisma.chamado.count({ where }),
  ]);

  return {
    dados,
    paginacao: {
      pagina,
      limite,
      total,
      totalPaginas: Math.ceil(total / limite),
    },
  };
}

/**
 * Retorna um chamado pelo ID com include de categoria, solicitante, atendente, comentários e tags.
 */
export async function obterChamadoPorId(id: number): Promise<ChamadoDetalhado> {
  const chamado = await prisma.chamado.findUnique({
    where: { id },
    include: INCLUDE_CHAMADO_DETALHADO,
  });

  if (!chamado) {
    throw new ErroAplicacao('Chamado não encontrado.', 404);
  }

  return chamado;
}

/**
 * Atualiza o status de um chamado de forma transacional.
 * Quando o novo status é RESOLVIDO, atualiza o status, grava a solução, cria o comentário
 * correspondente e regenera o embedding dentro da mesma transação.
 */
export async function atualizarStatusChamado(
  id: number,
  dados: AtualizarStatusChamadoInput,
  geradorEmbedding: GeradorEmbeddingFn = gerarEmbedding
): Promise<ChamadoDetalhado> {
  return prisma.$transaction(async (tx) => {
    const chamadoAtual = await tx.chamado.findUnique({
      where: { id },
      include: { categoria: true },
    });

    if (!chamadoAtual) {
      throw new ErroAplicacao('Chamado não encontrado.', 404);
    }

    if (chamadoAtual.status === StatusChamado.FECHADO) {
      throw new ErroAplicacao(
        'Um chamado com status FECHADO não pode ser reaberto ou sofrer transição de status.',
        409
      );
    }

    if (dados.atendenteId !== undefined && dados.atendenteId !== null) {
      await validarAtendenteTx(tx, dados.atendenteId);
    }

    if (dados.status === StatusChamado.RESOLVIDO) {
      const solucaoLimpa = dados.solucao?.trim();
      if (!solucaoLimpa) {
        throw new ErroAplicacao(
          'O campo "solucao" é obrigatório ao resolver um chamado.',
          400
        );
      }

      const autorComentarioId =
        dados.autorId ??
        dados.atendenteId ??
        chamadoAtual.atendenteId ??
        chamadoAtual.solicitanteId;

      const textoComentario =
        dados.comentario?.trim() || `Chamado resolvido. Solução aplicada: ${solucaoLimpa}`;

      const chamadoResolvido = await tx.chamado.update({
        where: { id },
        data: {
          status: StatusChamado.RESOLVIDO,
          solucao: solucaoLimpa,
          resolvidoEm: new Date(),
          ...(dados.atendenteId !== undefined ? { atendenteId: dados.atendenteId } : {}),
        },
      });

      await tx.comentario.create({
        data: {
          chamadoId: id,
          autorId: autorComentarioId,
          conteudo: textoComentario,
        },
      });

      await salvarEmbeddingChamadoTx(
        tx,
        {
          id: chamadoResolvido.id,
          titulo: chamadoResolvido.titulo,
          descricao: chamadoResolvido.descricao,
          solucao: chamadoResolvido.solucao,
          categoriaNome: chamadoAtual.categoria.nome,
        },
        geradorEmbedding
      );

      const detalhado = await tx.chamado.findUnique({
        where: { id },
        include: INCLUDE_CHAMADO_DETALHADO,
      });

      if (!detalhado) {
        throw new ErroAplicacao('Erro ao recarregar chamado resolvido.', 500);
      }

      return detalhado;
    }

    await tx.chamado.update({
      where: { id },
      data: {
        status: dados.status,
        ...(dados.solucao !== undefined ? { solucao: dados.solucao } : {}),
        ...(dados.atendenteId !== undefined ? { atendenteId: dados.atendenteId } : {}),
      },
    });

    if (dados.comentario?.trim()) {
      const autorComentarioId =
        dados.autorId ??
        dados.atendenteId ??
        chamadoAtual.atendenteId ??
        chamadoAtual.solicitanteId;

      await tx.comentario.create({
        data: {
          chamadoId: id,
          autorId: autorComentarioId,
          conteudo: dados.comentario.trim(),
        },
      });
    }

    const detalhado = await tx.chamado.findUnique({
      where: { id },
      include: INCLUDE_CHAMADO_DETALHADO,
    });

    if (!detalhado) {
      throw new ErroAplicacao('Erro ao recarregar chamado atualizado.', 500);
    }

    return detalhado;
  }).then(async (chamadoAtualizado) => {
    try {
      await sincronizarChamadoNoElastic(chamadoAtualizado.id);
    } catch (erroElastic: unknown) {
      const msg = erroElastic instanceof Error ? erroElastic.message : String(erroElastic);
      console.warn(`⚠️ Falha ao atualizar chamado #${chamadoAtualizado.id} no Elasticsearch: ${msg}`);
    }
    return chamadoAtualizado;
  });
}

/**
 * Adiciona um comentário ao histórico de um chamado existente dentro de uma transação.
 */
export async function criarComentarioChamado(
  chamadoId: number,
  dados: CriarComentarioInput
): Promise<Comentario> {
  return prisma.$transaction(async (tx) => {
    const chamado = await tx.chamado.findUnique({
      where: { id: chamadoId },
      select: { id: true },
    });

    if (!chamado) {
      throw new ErroAplicacao('Chamado não encontrado.', 404);
    }

    return tx.comentario.create({
      data: {
        chamadoId,
        autorId: dados.autorId,
        conteudo: dados.conteudo.trim(),
      },
    });
  });
}
