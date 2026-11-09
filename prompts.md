Ajustar Modelagem Prisma

Você é um engenheiro de backend sênior com experiência em Prisma ORM, PostgreSQL e extensão pgvector, trabalhando em um projeto Node/TypeScript existente. Preciso que você faça a Fase 1 da migração de modelagem (Trilha A) no arquivo `schema.prisma` do meu projeto, sem alterar nada além do necessário para essa fase.

O objetivo é que o modelo `Documentos` passe a armazenar embeddings vetoriais de 1536 dimensões ligados ao registro relacional correspondente, de forma que o vetor fique rastreável a um chamado ou a um artigo.

Requisitos que devem ser atendidos:

1. No modelo `Documentos`, adicionar a coluna `embedding` do tipo `Unsupported("vector(1536)")`, para que o Prisma reconheça a coluna sem tentar interpretá-la como tipo nativo.
2. Adicionar as colunas `chamadoId` e `artigoId` como opcionais (nullable), cada uma com relação e chave estrangeira (FK) apontando para os modelos `Chamado` e `Artigo` respectivamente, usando os nomes de campo e de modelo já existentes no meu schema. Se algum desses modelos não existir com esse nome, mantenha a convenção de nomes do restante do arquivo e sinalize a divergência no seu resumo final.
3. Declarar a extensão `vector` no bloco `datasource`. Use `previewFeatures = ["postgresqlExtensions"]` junto com `extensions = [vector]` quando a versão do Prisma exigir (Prisma 5.x e superiores com a feature habilitada) e verifique a versão em `package.json` antes de escolher a sintaxe. A finalidade é impedir que o Prisma tente remover a extensão durante `migrate`.
4. Não criar ainda índices vetoriais (HNSW/IVFFlat), não alterar outros modelos e não gerar migrations destrutivas. Se for necessário um índice de FK, pode incluí-lo, mas informe isso explicitamente.

Entregue: o bloco `datasource` e o modelo `Documentos` completos e prontos para colar, o comando de migration recomendado (por exemplo `npx prisma migrate dev --name ...`), e uma lista curta do que foi alterado, com qualquer suposição feita sobre nomes de modelos ou versão do Prisma.

Caso eu tenha colado trechos atuais do `schema.prisma` ou do `package.json`, use-os como base e preserve tudo que não faz parte desta fase.


Enriquecer modelagem Prisma do sistema 

# Prompt: Enriquecer a modelagem Prisma do sistema de chamados com relacionamentos complexos

Eu tenho um sistema de chamados (helpdesk/service desk) em TypeScript com Prisma. Preciso que você enriqueça o schema para demonstrar relacionamentos complexos, gere a migration e valide a integração com o Prisma 7. Trabalhe no código real do projeto, sem reescrever módulos que não fazem parte desta mudança.

**Objetivo:** ao final, o schema deve conter Comentario, Tag, ChamadoTag, Artigo e os novos campos de solução em Chamado, todos com relações e `onDelete` explícitos, e a migration aplicada com SQL conferido.

**Modelagem pedida:**
- **Comentario** (1:N com Chamado e com Usuario): registra o histórico de atendimento do chamado. Cada comentário pertence a um chamado e a um autor.
- **Tag** e **ChamadoTag** (N:N entre Chamado e Tag, usando tabela de junção explícita).
- **Artigo** (base de conhecimento) com título, conteúdo longo em texto, autor (Usuario) e categoria. Categoria deve ser modelada como entidade própria, não como string solta.
- **Chamado**: adicionar `solucao` (texto, opcional) e `resolvidoEm` (data/hora, opcional).
- **`onDelete` explícito em todas as relações novas e nas existentes que eu tocar**, com a escolha justificada pelo comportamento de negócio (ex.: apagar um chamado não deve apagar artigos; apagar um usuário autor de comentários precisa de decisão consciente).

**Migration e índice vetorial:**
- Rode `npx prisma migrate dev --name <nome-descritivo>`.
- Confira o SQL gerado. O índice HNSW existente precisa continuar presente na migration final. Se o Prisma não o gerar ou tentar removê-lo, use `--create-only`, edite o SQL à mão para preservar o índice HNSW, e então aplique a migration.
- Registre no IA_LOG se foi necessário editar o SQL manualmente, qual era o problema e como foi resolvido.

**Prisma 7:**
- Verifique a configuração atual de gerador e conexão. No Prisma 7 o padrão é o gerador `prisma-client` com a opção `output`, e a conexão ao banco é feita via driver adapter (`@prisma/adapter-pg`). Se o projeto usa `prisma-client-js`, avalie a migração para o padrão novo e explique o impacto no código de importação do client.
- Crie um script simples (ex.: `scripts/teste-prisma.ts`) que faça um `findMany` em uma das entidades existentes e confirme que o client conecta e retorna dados. Execute-o e reporte o resultado.

**Entregáveis esperados:**
1. Schema Prisma atualizado, com comentários explicando decisões de `onDelete` e de cardinalidade.
2. Migration gerada, com o SQL revisado e o HNSW preservado.
3. Ajustes necessários no gerador/adaptador para Prisma 7, com o `findMany` de teste funcionando.
4. Entrada no IA_LOG cobrindo migration, edição manual de SQL (se houver) e configuração do Prisma 7.

Não adicione funcionalidades de API, interface ou regras de negócio além do que está descrito. Se algum ponto da modelagem conflitar com o código existente, aponte o conflito e escolha a alternativa mais conservadora para não quebrar o que já funciona.


Estrutura do código 

Você é um engenheiro de software sênior, especialista em Node.js, TypeScript, Prisma, PostgreSQL, Elasticsearch e integração com a API do Gemini, responsável por reorganizar a estrutura de um backend existente e migrá-lo para TypeScript.

Preciso que você reestruture o backend localizado em `backend/` para o padrão abaixo, convertendo todo o código para TypeScript. O objetivo é deixar o projeto organizado em camadas claras (config, services, routes, middlewares), com um único Prisma Client compartilhado, sem alterar o comportamento funcional da aplicação.

Estrutura-alvo:

```
backend/
  src/
    config/        (prisma client, pg pool, gemini, elastic)
    services/      (chamadoService, embeddingService, ragService, buscaService)
    routes/        (chamados, artigos, categorias, usuarios, busca)
    middlewares/   (erros, validação)
    server.ts
    seed.ts
  scripts/         (utilitários avulsos)
```

Requisitos obrigatórios:

- Mover a lógica de `backend/scripts/embeddings.js` para `src/services/embeddingService.ts`. Preserve a lógica de geração de embeddings e a integração existente; apenas ajuste a localização, imports e tipagem.
- Criar um único Prisma Client compartilhado em `src/config/prisma.ts`, e fazer todos os serviços e rotas importarem dele, eliminando qualquer outra instância de `new PrismaClient()`.
- Converter todos os arquivos `.js` do backend para `.ts`, com tipagens explícitas nas funções públicas, nos retornos de serviços e nos payloads de requisição/resposta. Evite `any`; quando for inevitável, justifique em comentário curto.
- Adicionar ao `package.json` os scripts: `dev` (execução com recarregamento, ex.: tsx watch), `start` (execução do build compilado), `seed` (executa `src/seed.ts`), `migrate` (Prisma migrate) e `studio` (Prisma Studio), e `reindex` (reindexação de embeddings/Elasticsearch, usando a lógica movida para `embeddingService`). Ajuste também um script de build (`tsc`) necessário para o `start`.
- Configurar `tsconfig.json` adequado ao Node.js, com `outDir` apontando para um diretório de build e `strict` habilitado.
- Manter as dependências existentes (Prisma, pg pool, cliente Gemini, Elasticsearch) e instalar apenas os tipos e ferramentas estritamente necessários (ex.: `typescript`, `tsx`, `@types/node`, e tipos das bibliotecas usadas).
- Manter o comportamento de todas as rotas (`chamados`, `artigos`, `categorias`, `usuarios`, `busca`) e dos serviços (`chamadoService`, `ragService`, `buscaService`) idêntico ao atual; não introduzir novas funcionalidades, endpoints ou mudanças de contrato de API.
- Mover a lógica de validação e tratamento de erros para `middlewares/` (validação e erros), sem mudar as respostas HTTP existentes.
- Separar a configuração de conexões (pg pool, Gemini, Elasticsearch) em `src/config/`, lendo variáveis de ambiente de forma centralizada.

Procedimento de entrega:

1. Antes de alterar qualquer arquivo, leia a estrutura atual de `backend/` e liste mentalmente quais módulos existem e onde cada responsabilidade está hoje.
2. Execute a migração arquivo a arquivo, mantendo o código funcionalmente equivalente.
3. Confirme que `npm run build`, `npm run dev` e `npm start` funcionam, e que não restam imports apontando para arquivos `.js` antigos ou para instâncias extras do Prisma Client.
4. Ao final, apresente: a árvore de arquivos resultante, a lista de scripts adicionados ao `package.json`, e qualquer decisão de tipagem que exigiu escolha consciente.

Arquivo de referência: `backend/scripts/embeddings.js` (lógica a ser movida para `src/services/embeddingService.ts`).


API Rest 

Você é um engenheiro de back-end sênior especializado em Node.js, Express, Prisma ORM e PostgreSQL, com experiência em APIs REST de sistemas de help desk e gestão de chamados. Sua tarefa é implementar a Fase 4 de um projeto existente: uma API REST em Express que expõe as rotas mínimas descritas abaixo, com validação de entrada, operações transacionais e tratamento centralizado de erros do Prisma.

Antes de tudo, instale `express` e uma biblioteca de validação, `zod`, e use-as como base de toda a validação de entrada.

**Rotas obrigatórias**

- `POST /categorias` e `GET /categorias`
- `POST /usuarios` e `GET /usuarios`
- `POST /chamados`: cria o chamado e gera o embedding dele na mesma operação, de modo que o chamado e seu embedding sejam persistidos juntos ou nenhum dos dois seja.
- `GET /chamados`: aceita filtros por `status`, `categoria` e `prioridade`, e paginação.
- `GET /chamados/:id`: retorna o chamado com `include` de categoria, solicitante, atendente, comentários e tags.
- `PATCH /chamados/:id/status`
- `POST /chamados/:id/comentarios`
- `POST /artigos` e `GET /artigos`

**Regras de negócio transacionais**

Use `prisma.$transaction` em toda operação composta. O caso central é "resolver chamado", que deve, dentro de uma única transação, atualizar o status, gravar a solução, criar o comentário correspondente e reindexar (regenerar o embedding) o chamado. Se qualquer etapa falhar, todas devem ser revertidas.

Aplique estas regras de negócio:
- Somente um usuário com papel `ATENDENTE` pode ser atribuído como atendente de um chamado. Qualquer outro papel deve ser rejeitado.
- Um chamado com status `FECHADO` não pode ser reaberto. Tentativas de transição a partir de `FECHADO` devem ser recusadas.

Quando uma regra for violada por dados do cliente, responda com erro de validação ou de conflito, não com erro interno.

**Middleware de erros**

Crie um middleware centralizado de erros que traduza erros conhecidos do Prisma para respostas HTTP adequadas: `P2002` (violação de unicidade) deve virar `409`, e `P2003` (violação de chave estrangeira) deve virar `400`. Erros de validação do zod devem virar `400` com os detalhes dos campos inválidos. Erros não reconhecidos devem virar `500` sem vazar detalhes internos na resposta.

**Escopo**

Implemente apenas o que está listado. Não adicione autenticação, paginação em rotas que não a pedem, camadas de arquitetura extras nem funcionalidades fora da lista. Mantenha a estrutura de pastas e os padrões já existentes no projeto. Inclua testes que cubram pelo menos a transação de resolver chamado, a regra de atendente e a regra de não reabrir chamado fechado.