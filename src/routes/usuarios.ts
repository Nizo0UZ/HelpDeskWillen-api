import { prisma, type PapelUsuario, type Usuario } from '../config/prisma';
import { validarCamposObrigatorios } from '../middlewares/validacao';

export interface CriarUsuarioRequest {
  nome: string;
  email: string;
  senha: string;
  papel?: PapelUsuario;
  [chave: string]: unknown;
}

export type UsuarioPublico = Omit<Usuario, 'senha'>;

export interface UsuarioResponse {
  dados: UsuarioPublico | UsuarioPublico[];
}

export async function handleListarUsuarios(): Promise<UsuarioResponse> {
  const usuarios = await prisma.usuario.findMany({
    orderBy: { nome: 'asc' },
  });

  const dadosPublicos: UsuarioPublico[] = usuarios.map(({ senha: _senha, ...resto }) => resto);
  return { dados: dadosPublicos };
}

export function validarPayloadCriarUsuario(payload: unknown): CriarUsuarioRequest {
  return validarCamposObrigatorios<CriarUsuarioRequest>(payload, [
    { campo: 'nome', obrigatorio: true, tipo: 'string' },
    { campo: 'email', obrigatorio: true, tipo: 'string' },
    { campo: 'senha', obrigatorio: true, tipo: 'string' },
  ]);
}

