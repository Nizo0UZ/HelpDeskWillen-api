/*
  Warnings:

  - Added the required column `autor_id` to the `Artigo` table without a default value. This is not possible if the table is not empty.
  - Added the required column `categoria_id` to the `Artigo` table without a default value. This is not possible if the table is not empty.

  Revisão: a tabela "Artigo" foi criada pela migration anterior e estava vazia
  (0 linhas) quando esta foi gerada, então os NOT NULL são seguros aqui.
*/
-- AlterTable
ALTER TABLE "Artigo" ADD COLUMN     "autor_id" INTEGER NOT NULL,
ADD COLUMN     "categoria_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Chamado" ADD COLUMN     "resolvido_em" TIMESTAMP(3),
ADD COLUMN     "solucao" TEXT;

-- CreateTable
CREATE TABLE "Comentario" (
    "id" SERIAL NOT NULL,
    "conteudo" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chamado_id" INTEGER NOT NULL,
    "autor_id" INTEGER NOT NULL,

    CONSTRAINT "Comentario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChamadoTag" (
    "chamado_id" INTEGER NOT NULL,
    "tag_id" INTEGER NOT NULL,
    "atribuida_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChamadoTag_pkey" PRIMARY KEY ("chamado_id","tag_id")
);

-- CreateIndex
CREATE INDEX "Comentario_chamado_id_criado_em_idx" ON "Comentario"("chamado_id", "criado_em");

-- CreateIndex
CREATE INDEX "Comentario_autor_id_idx" ON "Comentario"("autor_id");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_nome_key" ON "Tag"("nome");

-- CreateIndex
CREATE INDEX "ChamadoTag_tag_id_idx" ON "ChamadoTag"("tag_id");

-- CreateIndex
CREATE INDEX "Artigo_autor_id_idx" ON "Artigo"("autor_id");

-- CreateIndex
CREATE INDEX "Artigo_categoria_id_idx" ON "Artigo"("categoria_id");

-- AddForeignKey
ALTER TABLE "Comentario" ADD CONSTRAINT "Comentario_chamado_id_fkey" FOREIGN KEY ("chamado_id") REFERENCES "Chamado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comentario" ADD CONSTRAINT "Comentario_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChamadoTag" ADD CONSTRAINT "ChamadoTag_chamado_id_fkey" FOREIGN KEY ("chamado_id") REFERENCES "Chamado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChamadoTag" ADD CONSTRAINT "ChamadoTag_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artigo" ADD CONSTRAINT "Artigo_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artigo" ADD CONSTRAINT "Artigo_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "Categoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- EDIÇÃO MANUAL (não gerada pelo Prisma) — ver IA_LOG.md
-- Recria o índice HNSW de busca vetorial em "Documentos".
-- A migration 20261108213939_documentos_fk_chamado_artigo contém
-- `DROP INDEX "documentos_embedding_hnsw_idx"`, gerado automaticamente porque
-- o Prisma 7.10 não suporta `type: Hnsw` no schema e trata o índice como drift.
-- Aquela migration não foi editada (pode já ter sido aplicada em outro ambiente);
-- o IF NOT EXISTS torna este passo seguro em bancos com ou sem o índice.
-- Definição idêntica à de 20261106004222_add_pgvector_documentos.
-- ============================================================
CREATE INDEX IF NOT EXISTS documentos_embedding_hnsw_idx
    ON "Documentos"
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
