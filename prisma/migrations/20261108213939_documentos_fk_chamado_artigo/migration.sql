-- DropIndex
DROP INDEX "documentos_embedding_hnsw_idx";

-- AlterTable
ALTER TABLE "Documentos" ADD COLUMN     "artigo_id" INTEGER,
ADD COLUMN     "chamado_id" INTEGER;

-- CreateTable
CREATE TABLE "Artigo" (
    "id" SERIAL NOT NULL,
    "titulo" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artigo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Documentos_chamado_id_idx" ON "Documentos"("chamado_id");

-- CreateIndex
CREATE INDEX "Documentos_artigo_id_idx" ON "Documentos"("artigo_id");

-- AddForeignKey
ALTER TABLE "Documentos" ADD CONSTRAINT "Documentos_chamado_id_fkey" FOREIGN KEY ("chamado_id") REFERENCES "Chamado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documentos" ADD CONSTRAINT "Documentos_artigo_id_fkey" FOREIGN KEY ("artigo_id") REFERENCES "Artigo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
