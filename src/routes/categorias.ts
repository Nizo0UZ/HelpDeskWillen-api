import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma, type Categoria } from '../config/prisma';
import { validarBody } from '../middlewares/validacao';

export const criarCategoriaSchema = z.object({
  nome: z.string().trim().min(1, 'O nome da categoria é obrigatório.'),
  descricao: z.string().trim().nullable().optional(),
  ativa: z.boolean().optional(),
});

export type CriarCategoriaRequest = z.infer<typeof criarCategoriaSchema>;

export const categoriasRouter = Router();

categoriasRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  const categorias: Categoria[] = await prisma.categoria.findMany({
    orderBy: { id: 'asc' },
  });
  res.status(200).json(categorias);
});

categoriasRouter.post(
  '/',
  validarBody(criarCategoriaSchema),
  async (req: Request, res: Response): Promise<void> => {
    const dados = req.body as CriarCategoriaRequest;
    const novaCategoria: Categoria = await prisma.categoria.create({
      data: {
        nome: dados.nome,
        descricao: dados.descricao ?? null,
        ...(dados.ativa !== undefined ? { ativa: dados.ativa } : {}),
      },
    });
    res.status(201).json(novaCategoria);
  }
);

export default categoriasRouter;
