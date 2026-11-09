import bcrypt from 'bcrypt';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PapelUsuario, prisma, type Usuario } from '../config/prisma';
import { validarBody } from '../middlewares/validacao';

const BCRYPT_SALT_ROUNDS = 10;

export const criarUsuarioSchema = z.object({
  nome: z.string().trim().min(1, 'O nome do usuário é obrigatório.'),
  email: z.string().trim().email('Informe um endereço de e-mail válido.'),
  senha: z.string().min(6, 'A senha deve ter pelo menos 6 caracteres.'),
  papel: z.enum([PapelUsuario.SOLICITANTE, PapelUsuario.ATENDENTE, PapelUsuario.ADMIN]).optional(),
  ativo: z.boolean().optional(),
});

export type CriarUsuarioRequest = z.infer<typeof criarUsuarioSchema>;
export type UsuarioPublico = Omit<Usuario, 'senha'>;

function omitirSenha(usuario: Usuario): UsuarioPublico {
  const { senha: _senha, ...publico } = usuario;
  return publico;
}

export const usuariosRouter = Router();

usuariosRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  const usuarios = await prisma.usuario.findMany({
    orderBy: { id: 'asc' },
  });
  res.status(200).json(usuarios.map(omitirSenha));
});

usuariosRouter.post(
  '/',
  validarBody(criarUsuarioSchema),
  async (req: Request, res: Response): Promise<void> => {
    const dados = req.body as CriarUsuarioRequest;
    const senhaHash = await bcrypt.hash(dados.senha, BCRYPT_SALT_ROUNDS);

    const novoUsuario = await prisma.usuario.create({
      data: {
        nome: dados.nome,
        email: dados.email,
        senha: senhaHash,
        papel: dados.papel ?? PapelUsuario.SOLICITANTE,
        ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}),
      },
    });

    res.status(201).json(omitirSenha(novoUsuario));
  }
);

export default usuariosRouter;
