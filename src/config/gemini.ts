import { GoogleGenAI } from '@google/genai';
import { env } from './env';

export const ai = new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY,
});

// Modelo de embedding atual do Google (substitui o text-embedding-004, descontinuado).
// Suporta 768, 1536 ou 3072 dimensões — usamos 1536 para casar com VECTOR(1536).
export const EMBEDDING_MODEL = 'gemini-embedding-001' as const;
export const EMBEDDING_DIMENSOES = 1536 as const;

