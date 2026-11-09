import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma, type Artigo } from '../config/prisma';
import { validarBody } from '../middlewares/validacao';

export const criarArtigoSchema = z.object({
  titulo: z.string().trim().min(1, 'O título do artigo é obrigatório.'),
  conteudo: z.string().trim().min(1, 'O conteúdo do artigo é obrigatório.'),
  autorId: z.number().int().positive('O ID do autor deve ser um inteiro positivo.'),
  categoriaId: z.number().int().positive('O ID da categoria deve ser um inteiro positivo.'),
});

export type CriarArtigoRequest = z.infer<typeof criarArtigoSchema>;

export const artigosRouter = Router();

artigosRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  const artigos: Artigo[] = await prisma.artigo.findMany({
    orderBy: { criadoEm: 'desc' },
  });
  res.status(200).json(artigos);
});

artigosRouter.post(
  '/',
  validarBody(criarArtigoSchema),
  async (req: Request, res: Response): Promise<void> => {
    const dados = req.body as CriarArtigoRequest;
    const novoArtigo: Artigo = await prisma.artigo.create({
      data: {
        titulo: dados.titulo,
        conteudo: dados.conteudo,
        autorId: dados.autorId,
        categoriaId: dados.categoriaId,
      },
    });
    res.status(201).json(novoArtigo);
  }
);

export default artigosRouter;
