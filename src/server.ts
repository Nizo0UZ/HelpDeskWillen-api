import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { elasticClient } from './config/elastic';
import { env } from './config/env';
import { encerrarPool } from './config/pg';
import { prisma } from './config/prisma';
import { tratarErroHttp } from './middlewares/erros';
import * as artigosRoutes from './routes/artigos';
import * as buscaRoutes from './routes/busca';
import * as categoriasRoutes from './routes/categorias';
import * as chamadosRoutes from './routes/chamados';
import * as usuariosRoutes from './routes/usuarios';

export interface StatusServidorResponse {
  status: 'ok';
  rotasRegistradas: readonly string[];
}

const ROTAS_DISPONIVEIS = [
  'chamados',
  'artigos',
  'categorias',
  'usuarios',
  'busca',
] as const;

// Garante carregamento dos módulos de rotas tipados com o Prisma Client único
void chamadosRoutes;
void artigosRoutes;
void categoriasRoutes;
void usuariosRoutes;
void buscaRoutes;

export function criarServidorHttp(): Server {
  return createServer((req: IncomingMessage, res: ServerResponse): void => {
    try {
      const payload: StatusServidorResponse = {
        status: 'ok',
        rotasRegistradas: ROTAS_DISPONIVEIS,
      };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    } catch (erro: unknown) {
      tratarErroHttp(erro, req, res);
    }
  });
}

export async function encerrarConexoes(): Promise<void> {
  await Promise.allSettled([
    prisma.$disconnect(),
    encerrarPool(),
    elasticClient.close(),
  ]);
}

if (require.main === module) {
  const server = criarServidorHttp();

  server.listen(env.PORT, () => {
    console.log(`🚀 Servidor iniciado na porta ${env.PORT}`);
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

