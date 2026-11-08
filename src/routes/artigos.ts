import { prisma, type Artigo } from '../config/prisma';
import { validarCamposObrigatorios } from '../middlewares/validacao';

export interface CriarArtigoRequest {
  titulo: string;
  conteudo: string;
  autorId: number;
  categoriaId: number;
  [chave: string]: unknown;
}

export interface ArtigoResponse {
  dados: Artigo | Artigo[];
}

export async function handleListarArtigos(): Promise<ArtigoResponse> {
  const artigos = await prisma.artigo.findMany({
    orderBy: { criadoEm: 'desc' },
  });
  return { dados: artigos };
}

export function validarPayloadCriarArtigo(payload: unknown): CriarArtigoRequest {
  return validarCamposObrigatorios<CriarArtigoRequest>(payload, [
    { campo: 'titulo', obrigatorio: true, tipo: 'string' },
    { campo: 'conteudo', obrigatorio: true, tipo: 'string' },
    { campo: 'autorId', obrigatorio: true, tipo: 'number' },
    { campo: 'categoriaId', obrigatorio: true, tipo: 'number' },
  ]);
}

