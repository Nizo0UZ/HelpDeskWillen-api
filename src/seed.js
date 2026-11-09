// Entrada CommonJS para permitir tanto `node src/seed.js` quanto `npm run seed`
require('tsx/cjs');
const { executarSeedCli } = require('./seed.ts');

void executarSeedCli();

