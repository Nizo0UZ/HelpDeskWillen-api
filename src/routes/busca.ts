import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { LIMIAR_SIMILARIDADE_PADRAO } from '../config/gemini';
import { StatusChamado } from '../config/prisma';
import { validarBody, validarDados } from '../middlewares/validacao';
import {
  buscarPorSimilaridade,
  buscarPorTextoElastic,
  compararBuscas,
} from '../services/buscaService';
import { perguntarRag } from '../services/ragService';

export const buscaSemanticaQuerySchema = z.object({
  q: z.string().trim().min(1, 'O parâmetro de busca "q" é obrigatório.'),
  k: z.coerce.number().int().positive().max(50).optional().default(5),
  status: z
    .enum([
      StatusChamado.ABERTO,
      StatusChamado.EM_ANDAMENTO,
      StatusChamado.AGUARDANDO,
      StatusChamado.RESOLVIDO,
      StatusChamado.FECHADO,
    ])
    .optional(),
  categoria: z.union([z.string(), z.number()]).optional(),
  categoriaId: z.coerce.number().int().positive().optional(),
  limiar: z.coerce
    .number()
    .min(0, 'O limiar deve ser entre 0 e 1.')
    .max(1, 'O limiar deve ser entre 0 e 1.')
    .optional()
    .default(LIMIAR_SIMILARIDADE_PADRAO),
  incluirArtigos: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const buscaTextoQuerySchema = z.object({
  q: z.string().trim().min(1, 'O parâmetro de busca "q" é obrigatório.'),
  k: z.coerce.number().int().positive().max(50).optional().default(5),
  status: z
    .enum([
      StatusChamado.ABERTO,
      StatusChamado.EM_ANDAMENTO,
      StatusChamado.AGUARDANDO,
      StatusChamado.RESOLVIDO,
      StatusChamado.FECHADO,
    ])
    .optional(),
  categoriaId: z.coerce.number().int().positive().optional(),
});

export const ragPerguntarBodySchema = z.object({
  pergunta: z.string().trim().min(1, 'O campo "pergunta" é obrigatório.'),
  k: z.number().int().positive().max(20).optional().default(5),
  status: z
    .enum([
      StatusChamado.ABERTO,
      StatusChamado.EM_ANDAMENTO,
      StatusChamado.AGUARDANDO,
      StatusChamado.RESOLVIDO,
      StatusChamado.FECHADO,
    ])
    .optional(),
  categoria: z.union([z.string(), z.number()]).optional(),
  categoriaId: z.number().int().positive().optional(),
  limiar: z
    .number()
    .min(0, 'O limiar deve ser entre 0 e 1.')
    .max(1, 'O limiar deve ser entre 0 e 1.')
    .optional()
    .default(LIMIAR_SIMILARIDADE_PADRAO),
});

export type BuscaSemanticaQuery = z.infer<typeof buscaSemanticaQuerySchema>;
export type BuscaTextoQuery = z.infer<typeof buscaTextoQuerySchema>;
export type RagPerguntarRequest = z.infer<typeof ragPerguntarBodySchema>;

export const buscaRouter = Router();
export const ragRouter = Router();

buscaRouter.get(
  '/semantica',
  async (req: Request, res: Response): Promise<void> => {
    const query = validarDados(buscaSemanticaQuerySchema, req.query);
    const resultado = await buscarPorSimilaridade({
      query: query.q,
      k: query.k,
      status: query.status,
      categoria: query.categoria,
      categoriaId: query.categoriaId,
      limiar: query.limiar,
      apenasChamados: !query.incluirArtigos,
    });

    res.status(200).json(resultado);
  }
);

buscaRouter.get(
  '/texto',
  async (req: Request, res: Response): Promise<void> => {
    const query = validarDados(buscaTextoQuerySchema, req.query);
    const resultado = await buscarPorTextoElastic({
      query: query.q,
      k: query.k,
      status: query.status,
      categoriaId: query.categoriaId,
    });

    res.status(200).json(resultado);
  }
);

buscaRouter.get(
  '/comparar',
  async (req: Request, res: Response): Promise<void> => {
    const query = validarDados(buscaTextoQuerySchema, req.query);
    const comparacao = await compararBuscas(query.q, query.k);

    res.status(200).json(comparacao);
  }
);

ragRouter.post(
  '/perguntar',
  validarBody(ragPerguntarBodySchema),
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as RagPerguntarRequest;
    const resposta = await perguntarRag({
      pergunta: body.pergunta,
      k: body.k,
      status: body.status,
      categoria: body.categoria,
      categoriaId: body.categoriaId,
      limiar: body.limiar,
    });

    res.status(200).json(resposta);
  }
);

export default buscaRouter;
