-- Migration: habilitar pgvector e criar tabela Documentos
-- Executada automaticamente pelo Prisma (ou manualmente via psql)

-- ============================================================
-- 1. Habilitar a extensão pgvector
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 2. Criar tabela Documentos com coluna de embedding
-- ============================================================
CREATE TABLE IF NOT EXISTS "Documentos" (
    id          SERIAL PRIMARY KEY,

    -- Conteúdo textual do trecho indexado (ex.: descrição de chamado)
    conteudo    TEXT        NOT NULL,

    -- Metadados livres: fonte, chamado_id, categoria, etc.
    metadata    JSONB       NOT NULL DEFAULT '{}',

    -- Vetor de embedding gerado pelo Google gemini-embedding-001 (1536 dimensões)
    embedding   VECTOR(1536) NOT NULL,

    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. Índice HNSW para busca por similaridade de cosseno
--    (pgvector >= 0.5 — recomendado para produção)
-- ============================================================
CREATE INDEX IF NOT EXISTS documentos_embedding_hnsw_idx
    ON "Documentos"
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

