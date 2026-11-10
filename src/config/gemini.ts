import { GoogleGenAI } from '@google/genai';
import { env } from './env';

export const ai = new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY,
});

// Modelo de embedding atual do Google (substitui o text-embedding-004, descontinuado).
// Suporta 768, 1536 ou 3072 dimensões — usamos 1536 para casar com VECTOR(1536).
export const EMBEDDING_MODEL = 'gemini-embedding-001' as const;
export const EMBEDDING_DIMENSOES = 1536 as const;

// Modelo generativo principal e fallbacks para a etapa "G" (Generation) do RAG
export const GENERATION_MODEL =
  process.env.GEMINI_MODEL || ('gemini-3.5-flash' as const);

export const GENERATION_MODELS_FALLBACK: readonly string[] = [
  GENERATION_MODEL,
  'gemini-3.5-flash-lite',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
];

// Limiar mínimo de similaridade de cosseno (0 a 1) para descartar resultados irrelevantes
export const LIMIAR_SIMILARIDADE_PADRAO = 0.55 as const;
