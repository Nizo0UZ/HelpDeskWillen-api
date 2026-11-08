import { prisma, type Categoria } from '../config/prisma';
import { validarCamposObrigatorios } from '../middlewares/validacao';

export interface CriarCategoriaRequest {
  nome: string;
  descricao?: string | null;
  ativa?: boolean;
  [chave: string]: unknown;
}

export interface CategoriaResponse {
  dados: Categoria | Categoria[];
}

export async function handleListarCategorias(): Promise<CategoriaResponse> {
  const categorias = await prisma.categoria.findMany({
    orderBy: { nome: 'asc' },
  });
  return { dados: categorias };
}

export function validarPayloadCriarCategoria(payload: unknown): CriarCategoriaRequest {
  return validarCamposObrigatorios<CriarCategoriaRequest>(payload, [
    { campo: 'nome', obrigatorio: true, tipo: 'string' },
  ]);
}

