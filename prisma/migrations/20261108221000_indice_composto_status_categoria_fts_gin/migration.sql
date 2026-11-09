-- CreateIndex: Índice B-tree composto para filtros combinados por status e categoria
CREATE INDEX IF NOT EXISTS "Chamado_status_categoria_id_idx" ON "Chamado"("status", "categoria_id");

-- CreateIndex: Índice GIN para Full-Text Search nativo do PostgreSQL (dicionário portuguese)
CREATE INDEX IF NOT EXISTS "chamado_fts_gin_idx"
    ON "Chamado"
    USING gin (
        to_tsvector(
            'portuguese',
            coalesce("titulo", '') || ' ' || coalesce("descricao", '') || ' ' || coalesce("solucao", '')
        )
    );

-- Garantia idempotente do índice vetorial HNSW em "Documentos"
CREATE INDEX IF NOT EXISTS documentos_embedding_hnsw_idx
    ON "Documentos"
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

