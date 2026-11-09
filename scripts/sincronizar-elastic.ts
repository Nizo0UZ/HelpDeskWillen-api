import { elasticClient } from '../src/config/elastic';
import { encerrarPool } from '../src/config/pg';
import { prisma } from '../src/config/prisma';
import {
  compararBuscas,
  sincronizarTodosChamadosBulk,
} from '../src/services/buscaService';

async function main(): Promise<void> {
  console.log('🚀 Iniciando sincronização em massa (Bulk) PostgreSQL → Elasticsearch...');
  const resumo = await sincronizarTodosChamadosBulk({
    recriarIndice: true,
    tamanhoLote: 1000,
  });

  console.log('\n✅ Sincronização Bulk concluída:');
  console.table(resumo);

  // Pergunta com erro de digitação proposital ("impresora atolando") e linguagem natural
  // para evidenciar a diferença entre ILIKE, Elasticsearch (brazilian + fuzziness) e pgvector (semântica)
  const perguntasComparacao = [
    'impresora manchando folha e atolando papel',
    'nao consigo entrar no notebook porque esqueci minha credencial',
  ];

  for (const pergunta of perguntasComparacao) {
    console.log(`\n======================================================================`);
    console.log(`🔎 Comparação para a pergunta: "${pergunta}"`);
    console.log(`======================================================================`);

    const comp = await compararBuscas(pergunta, 3);

    console.log(`\n1️⃣ PostgreSQL ILIKE (${comp.ilikePostgres.tempoMs}ms) — Encontrados: ${comp.ilikePostgres.total}`);
    if (comp.ilikePostgres.resultados.length > 0) {
      console.table(comp.ilikePostgres.resultados.map((r) => ({ id: r.id, titulo: r.titulo })));
    }

    console.log(`\n2️⃣ Elasticsearch multi_match + fuzziness + highlight (${comp.elasticsearch.tempoMs}ms) — Total hits: ${comp.elasticsearch.total}`);
    if (comp.elasticsearch.resultados.length > 0) {
      console.table(
        comp.elasticsearch.resultados.map((r) => ({
          id: r.id,
          score: Number(r.score.toFixed(2)),
          titulo: r.titulo.substring(0, 55),
          highlight: (r.highlight.titulo?.[0] ?? r.highlight.descricao?.[0] ?? '').substring(0, 60),
        }))
      );
    }

    console.log(`\n3️⃣ Busca Semântica pgvector (${comp.semanticaPgvector.tempoMs}ms) — Encontrados (>= limiar): ${comp.semanticaPgvector.total}`);
    if (comp.semanticaPgvector.resultados.length > 0) {
      console.table(
        comp.semanticaPgvector.resultados.map((r) => ({
          chamadoId: r.chamadoId,
          similaridade: r.similaridade,
          titulo: r.titulo.substring(0, 65),
        }))
      );
    }
  }
}

main()
  .catch((erro: unknown) => {
    console.error('❌ Falha na sincronização com o Elasticsearch:', erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([
      elasticClient.close(),
      prisma.$disconnect(),
      encerrarPool(),
    ]);
  });

