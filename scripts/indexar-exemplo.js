require("dotenv").config();
const { Client } = require("@elastic/elasticsearch");

const client = new Client({
  node: process.env.ELASTICSEARCH_URL || "http://localhost:9200",
});

async function main() {
  const indice = "chamados";
  const documento = {
    titulo: "Computador não liga",
    descricao: "O computador da recepção não responde ao botão de energia.",
  };

  const resposta = await client.index({
    index: indice,
    id: "exemplo-1",
    document: documento,
    refresh: "wait_for",
  });

  console.log(`Documento indexado em "${indice}": ${resposta.result}`);
}

main()
  .catch((erro) => {
    console.error("Falha ao indexar:", erro);
    process.exitCode = 1;
  })
  .finally(() => client.close());
