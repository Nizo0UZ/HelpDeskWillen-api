import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';

export function validarDados<T>(schema: z.ZodType<T>, dados: unknown): T {
  return schema.parse(dados);
}

export function validarBody<T>(schema: z.ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.body = schema.parse(req.body);
    next();
  };
}
