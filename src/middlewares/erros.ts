import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../config/prisma';

export interface DetalheCampoInvalido {
  campo: string;
  mensagem: string;
}

export interface RespostaErroHttp {
  erro: string;
  codigo?: string;
  detalhes?: DetalheCampoInvalido[];
}

export class ErroAplicacao extends Error {
  public readonly statusCode: number;
  public readonly codigo?: string;

  constructor(mensagem: string, statusCode: number = 400, codigo?: string) {
    super(mensagem);
    this.name = 'ErroAplicacao';
    this.statusCode = statusCode;
    this.codigo = codigo;
  }
}

interface ErroComCodigoPrisma {
  code: string;
  meta?: Record<string, unknown>;
}

function ehErroPrismaComCodigo(erro: unknown): erro is ErroComCodigoPrisma {
  if (erro instanceof Prisma.PrismaClientKnownRequestError) {
    return true;
  }
  return (
    typeof erro === 'object' &&
    erro !== null &&
    'code' in erro &&
    typeof (erro as { code: unknown }).code === 'string'
  );
}

export function formatarErro(erro: unknown): {
  statusCode: number;
  corpo: RespostaErroHttp;
} {
  if (erro instanceof ZodError) {
    const detalhes: DetalheCampoInvalido[] = erro.issues.map((issue) => ({
      campo: issue.path.join('.') || 'payload',
      mensagem: issue.message,
    }));

    return {
      statusCode: 400,
      corpo: {
        erro: 'Dados de entrada inválidos.',
        detalhes,
      },
    };
  }

  if (ehErroPrismaComCodigo(erro)) {
    if (erro.code === 'P2002') {
      return {
        statusCode: 409,
        corpo: {
          erro: 'Conflito: já existe um registro com o valor informado para um campo único.',
          codigo: 'P2002',
        },
      };
    }

    if (erro.code === 'P2003') {
      return {
        statusCode: 400,
        corpo: {
          erro: 'Referência inválida: o registro relacionado informado não existe.',
          codigo: 'P2003',
        },
      };
    }
  }

  if (erro instanceof ErroAplicacao) {
    return {
      statusCode: erro.statusCode,
      corpo: {
        erro: erro.message,
        ...(erro.codigo ? { codigo: erro.codigo } : {}),
      },
    };
  }

  return {
    statusCode: 500,
    corpo: {
      erro: 'Erro interno do servidor.',
    },
  };
}

export function middlewareErros(
  erro: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const { statusCode, corpo } = formatarErro(erro);
  res.status(statusCode).json(corpo);
}
