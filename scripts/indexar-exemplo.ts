import { elasticClient, INDICE_CHAMADOS } from '../src/config/elastic';
import type { DocumentoChamadoIndexado } from '../src/services/buscaService';

async function main(): Promise<void> {
  const indice = INDICE_CHAMADOS;
  const documento: DocumentoChamadoIndexado = {
    titulo: 'Computador não liga',
    descricao: 'O computador da recepção não responde ao botão de energia.',
  };

  const resposta = await elasticClient.index({
    index: indice,
    id: 'exemplo-1',
    document: documento,
    refresh: 'wait_for',
  });

  console.log(`Documento indexado em "${indice}": ${resposta.result}`);
}

main()
  .catch((erro: unknown) => {
    console.error('Falha ao indexar:', erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await elasticClient.close();
  });

