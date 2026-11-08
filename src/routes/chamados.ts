import {
  prisma,
  type Chamado,
  type PrioridadeChamado,
  type StatusChamado,
} from '../config/prisma';
import { validarCamposObrigatorios } from '../middlewares/validacao';
import {
  listarChamados,
  obterChamadoPorId,
  type FiltrosChamado,
} from '../services/chamadoService';

export interface CriarChamadoRequest {
  titulo: string;
  descricao: string;
  categoriaId: number;
  solicitanteId: number;
  atendenteId?: number | null;
  prioridade?: PrioridadeChamado;
  [chave: string]: unknown;
}

export interface AtualizarStatusChamadoRequest {
  status: StatusChamado;
  solucao?: string | null;
  atendenteId?: number | null;
  [chave: string]: unknown;
}

export interface ChamadoResponse {
  dados: Chamado | Chamado[];
}

export async function handleListarChamados(
  filtros: FiltrosChamado = {}
): Promise<ChamadoResponse> {
  void prisma;
  const chamados = await listarChamados(filtros);
  return { dados: chamados };
}

export async function handleObterChamado(id: number): Promise<Chamado | null> {
  return obterChamadoPorId(id);
}

export function validarPayloadCriarChamado(payload: unknown): CriarChamadoRequest {
  return validarCamposObrigatorios<CriarChamadoRequest>(payload, [
    { campo: 'titulo', obrigatorio: true, tipo: 'string' },
    { campo: 'descricao', obrigatorio: true, tipo: 'string' },
    { campo: 'categoriaId', obrigatorio: true, tipo: 'number' },
    { campo: 'solicitanteId', obrigatorio: true, tipo: 'number' },
  ]);
}

