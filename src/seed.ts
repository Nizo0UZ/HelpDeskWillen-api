import { prisma } from './config/prisma';

export interface ResumoSeed {
  usuarios: number;
  categorias: number;
  chamados: number;
  artigos: number;
}

export async function executarSeed(): Promise<ResumoSeed> {
  const [usuarios, categorias, chamados, artigos] = await prisma.$transaction([
    prisma.usuario.count(),
    prisma.categoria.count(),
    prisma.chamado.count(),
    prisma.artigo.count(),
  ]);

  return {
    usuarios,
    categorias,
    chamados,
    artigos,
  };
}

if (require.main === module) {
  executarSeed()
    .then((resumo: ResumoSeed) => {
      console.log('🌱 Estado atual do banco (seed):', resumo);
    })
    .catch((erro: unknown) => {
      console.error('❌ Falha ao executar seed:', erro);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

