import 'dotenv/config';

export interface EnvConfig {
  readonly DATABASE_URL: string;
  readonly GEMINI_API_KEY: string;
  readonly ELASTICSEARCH_URL: string;
  readonly PORT: number;
}

function obterEnvObrigatoria(chave: string): string {
  const valor = process.env[chave];
  if (!valor) {
    throw new Error(`Variável de ambiente obrigatória não definida: ${chave}`);
  }
  return valor;
}

export const env: EnvConfig = {
  DATABASE_URL: obterEnvObrigatoria('DATABASE_URL'),
  GEMINI_API_KEY: obterEnvObrigatoria('GEMINI_API_KEY'),
  ELASTICSEARCH_URL: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
  PORT: Number(process.env.PORT) || 3000,
};

