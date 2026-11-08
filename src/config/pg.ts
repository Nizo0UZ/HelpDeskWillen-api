import { Pool, type PoolClient } from 'pg';
import pgvector from 'pgvector/pg';
import { env } from './env';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

/**
 * Retorna um cliente pg já com o tipo VECTOR registrado.
 */
export async function clienteComVetor(): Promise<PoolClient> {
  const client = await pool.connect();
  await pgvector.registerType(client);
  return client;
}

/**
 * Encerra a pool de conexões PostgreSQL.
 */
export async function encerrarPool(): Promise<void> {
  await pool.end();
}

