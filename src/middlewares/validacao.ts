import { ErroAplicacao } from './erros';

export interface RegraCampo {
  campo: string;
  obrigatorio?: boolean;
  tipo?: 'string' | 'number' | 'boolean';
}

export type ObjetoGenerico = Record<string, unknown>;

export function validarCamposObrigatorios<T extends ObjetoGenerico>(
  payload: unknown,
  regras: readonly RegraCampo[]
): T {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ErroAplicacao('O corpo da requisição deve ser um objeto JSON válido.', 400);
  }

  const registro = payload as ObjetoGenerico;

  for (const regra of regras) {
    const valor = registro[regra.campo];

    if (regra.obrigatorio && (valor === undefined || valor === null || valor === '')) {
      throw new ErroAplicacao(`O campo "${regra.campo}" é obrigatório.`, 400);
    }

    if (valor !== undefined && valor !== null && regra.tipo && typeof valor !== regra.tipo) {
      throw new ErroAplicacao(
        `O campo "${regra.campo}" deve ser do tipo ${regra.tipo}.`,
        400
      );
    }
  }

  return registro as T;
}

