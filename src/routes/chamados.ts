import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PrioridadeChamado, StatusChamado } from '../config/prisma';
import { validarBody, validarDados } from '../middlewares/validacao';
import {
  atualizarStatusChamado,
  criarChamado,
  criarComentarioChamado,
  listarChamados,
  obterChamadoPorId,
} from '../services/chamadoService';

const idParamSchema = z.object({
  id: z.coerce.number().int().positive('O ID do chamado deve ser um inteiro positivo.'),
});

export const criarChamadoSchema = z.object({
  titulo: z.string().trim().min(1, 'O título do chamado é obrigatório.'),
  descricao: z.string().trim().min(1, 'A descrição do chamado é obrigatória.'),
  categoriaId: z.number().int().positive('O ID da categoria deve ser um inteiro positivo.'),
  solicitanteId: z.number().int().positive('O ID do solicitante deve ser um inteiro positivo.'),
  atendenteId: z
    .number()
    .int()
    .positive('O ID do atendente deve ser um inteiro positivo.')
    .nullable()
    .optional(),
  prioridade: z
    .enum([
      PrioridadeChamado.BAIXA,
      PrioridadeChamado.MEDIA,
      PrioridadeChamado.ALTA,
      PrioridadeChamado.URGENTE,
    ])
    .optional(),
});

export const listarChamadosQuerySchema = z.object({
  status: z
    .enum([
      StatusChamado.ABERTO,
      StatusChamado.EM_ANDAMENTO,
      StatusChamado.AGUARDANDO,
      StatusChamado.RESOLVIDO,
      StatusChamado.FECHADO,
    ])
    .optional(),
  prioridade: z
    .enum([
      PrioridadeChamado.BAIXA,
      PrioridadeChamado.MEDIA,
      PrioridadeChamado.ALTA,
      PrioridadeChamado.URGENTE,
    ])
    .optional(),
  categoria: z.union([z.string(), z.number()]).optional(),
  categoriaId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional(),
  pagina: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  limite: z.coerce.number().int().positive().max(100).optional(),
});

export const atualizarStatusChamadoSchema = z
  .object({
    status: z.enum([
      StatusChamado.ABERTO,
      StatusChamado.EM_ANDAMENTO,
      StatusChamado.AGUARDANDO,
      StatusChamado.RESOLVIDO,
      StatusChamado.FECHADO,
    ]),
    solucao: z.string().trim().nullable().optional(),
    atendenteId: z.number().int().positive().nullable().optional(),
    autorId: z.number().int().positive().optional(),
    comentario: z.string().trim().optional(),
  })
  .superRefine((dados, ctx) => {
    if (dados.status === StatusChamado.RESOLVIDO && !dados.solucao?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['solucao'],
        message: 'O campo "solucao" é obrigatório ao resolver um chamado.',
      });
    }
  });

export const criarComentarioSchema = z.object({
  autorId: z.number().int().positive('O ID do autor é obrigatório.'),
  conteudo: z.string().trim().min(1, 'O conteúdo do comentário é obrigatório.'),
});

export type CriarChamadoRequest = z.infer<typeof criarChamadoSchema>;
export type AtualizarStatusChamadoRequest = z.infer<typeof atualizarStatusChamadoSchema>;
export type CriarComentarioRequest = z.infer<typeof criarComentarioSchema>;

export const chamadosRouter = Router();

chamadosRouter.post(
  '/',
  validarBody(criarChamadoSchema),
  async (req: Request, res: Response): Promise<void> => {
    const dados = req.body as CriarChamadoRequest;
    const chamado = await criarChamado(dados);
    res.status(201).json(chamado);
  }
);

chamadosRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const query = validarDados(listarChamadosQuerySchema, req.query);
  const resultado = await listarChamados({
    status: query.status,
    prioridade: query.prioridade,
    categoria: query.categoria,
    categoriaId: query.categoriaId,
    pagina: query.pagina ?? query.page ?? 1,
    limite: query.limite ?? query.limit ?? 20,
  });
  res.status(200).json(resultado);
});

chamadosRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = validarDados(idParamSchema, req.params);
  const chamado = await obterChamadoPorId(id);
  res.status(200).json(chamado);
});

chamadosRouter.patch(
  '/:id/status',
  validarBody(atualizarStatusChamadoSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { id } = validarDados(idParamSchema, req.params);
    const dados = req.body as AtualizarStatusChamadoRequest;
    const chamadoAtualizado = await atualizarStatusChamado(id, dados);
    res.status(200).json(chamadoAtualizado);
  }
);

chamadosRouter.post(
  '/:id/comentarios',
  validarBody(criarComentarioSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { id } = validarDados(idParamSchema, req.params);
    const dados = req.body as CriarComentarioRequest;
    const comentario = await criarComentarioChamado(id, dados);
    res.status(201).json(comentario);
  }
);

export default chamadosRouter;
