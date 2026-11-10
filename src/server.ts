import express, { type Express } from 'express';
import { elasticClient } from './config/elastic';
import { env } from './config/env';
import { encerrarPool } from './config/pg';
import { prisma } from './config/prisma';
import { middlewareErros } from './middlewares/erros';
import { artigosRouter } from './routes/artigos';
import { buscaRouter, ragRouter } from './routes/busca';
import { categoriasRouter } from './routes/categorias';
import { chamadosRouter } from './routes/chamados';
import { usuariosRouter } from './routes/usuarios';

export function criarApp(): Express {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());

  app.use('/categorias', categoriasRouter);
  app.use('/usuarios', usuariosRouter);
  app.use('/chamados', chamadosRouter);
  app.use('/artigos', artigosRouter);
  app.use('/busca', buscaRouter);
  app.use('/rag', ragRouter);

  app.use(middlewareErros);

  return app;
}

export const app = criarApp();

export async function encerrarConexoes(): Promise<void> {
  await Promise.allSettled([
    prisma.$disconnect(),
    encerrarPool(),
    elasticClient.close(),
  ]);
}

if (require.main === module) {
  const server = app.listen(env.PORT, () => {
    console.log(`Servidor Express iniciado na porta ${env.PORT}`);
  });

  const finalizar = async (): Promise<void> => {
    server.close();
    await encerrarConexoes();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void finalizar();
  });
  process.on('SIGTERM', () => {
    void finalizar();
  });
}
