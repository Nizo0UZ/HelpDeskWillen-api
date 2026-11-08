import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RespostaErroHttp {
  erro: string;
  detalhes?: string;
  codigo?: string;
}

export class ErroAplicacao extends Error {
  public readonly statusCode: number;
  public readonly codigo?: string;

  constructor(mensagem: string, statusCode: number = 500, codigo?: string) {
    super(mensagem);
    this.name = 'ErroAplicacao';
    this.statusCode = statusCode;
    this.codigo = codigo;
  }
}

export function formatarErro(erro: unknown): {
  statusCode: number;
  corpo: RespostaErroHttp;
} {
  if (erro instanceof ErroAplicacao) {
    return {
      statusCode: erro.statusCode,
      corpo: {
        erro: erro.message,
        ...(erro.codigo ? { codigo: erro.codigo } : {}),
      },
    };
  }

  if (erro instanceof Error) {
    return {
      statusCode: 500,
      corpo: {
        erro: 'Erro interno do servidor',
        detalhes: erro.message,
      },
    };
  }

  return {
    statusCode: 500,
    corpo: {
      erro: 'Erro interno desconhecido',
    },
  };
}

export function tratarErroHttp(
  erro: unknown,
  _req: IncomingMessage,
  res: ServerResponse
): void {
  const { statusCode, corpo } = formatarErro(erro);
  if (!res.headersSent) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  }
  res.end(JSON.stringify(corpo));
}

