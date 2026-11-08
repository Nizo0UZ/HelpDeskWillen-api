import {
  prisma,
  type Chamado,
  type PrioridadeChamado,
  type StatusChamado,
} from '../config/prisma';

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
}

export interface FiltrosChamado {
  status?: StatusChamado;
  prioridade?: PrioridadeChamado;
  categoriaId?: number;
  solicitanteId?: number;
  atendenteId?: number;
}

export async function listarChamados(filtros: FiltrosChamado = {}): Promise<Chamado[]> {
  return prisma.chamado.findMany({
    where: {
      ...(filtros.status !== undefined ? { status: filtros.status } : {}),
      ...(filtros.prioridade !== undefined ? { prioridade: filtros.prioridade } : {}),
      ...(filtros.categoriaId !== undefined ? { categoriaId: filtros.categoriaId } : {}),
      ...(filtros.solicitanteId !== undefined ? { solicitanteId: filtros.solicitanteId } : {}),
      ...(filtros.atendenteId !== undefined ? { atendenteId: filtros.atendenteId } : {}),
    },
    orderBy: { criadoEm: 'desc' },
  });
}

export async function obterChamadoPorId(id: number): Promise<Chamado | null> {
  return prisma.chamado.findUnique({
    where: { id },
  });
}

