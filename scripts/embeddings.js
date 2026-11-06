// scripts/embeddings.js
// Utilitário para gerar e armazenar embeddings no PostgreSQL via pgvector.
// Usa a API do Google Gemini (gratuita) para gerar os embeddings.
//
// Uso:
//   node scripts/embeddings.js

'use strict';

const { Pool } = require('pg');
const { GoogleGenAI } = require('@google/genai');
const pgvector = require('pgvector/pg');

require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Modelo de embedding atual do Google (substitui o text-embedding-004, descontinuado).
// Suporta 768, 1536 ou 3072 dimensões — usamos 1536 para casar com VECTOR(1536).
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSOES = 1536;

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Retorna um cliente pg já com o tipo VECTOR registrado. */
async function clienteComVetor() {
    const client = await pool.connect();
    await pgvector.registerType(client);
    return client;
}

// ---------------------------------------------------------------------------
// Funções exportáveis
// ---------------------------------------------------------------------------

/**
 * Gera um embedding para o texto fornecido usando Google Gemini.
 * @param {string} texto
 * @returns {Promise<number[]>} Array de 1536 floats (gemini-embedding-001)
 */
async function gerarEmbedding(texto) {
    const response = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: texto.trim(),
        config: { outputDimensionality: EMBEDDING_DIMENSOES },
    });
    return response.embeddings[0].values;
}

/**
 * Insere um documento com seu embedding na tabela "Documentos".
 * @param {string} conteudo  Texto que será indexado
 * @param {object} metadata  Dados extras (ex.: { chamado_id: 1, categoria: 'Rede' })
 * @returns {Promise<number>} ID do registro inserido
 */
async function inserirDocumento(conteudo, metadata = {}) {
    const embedding = await gerarEmbedding(conteudo);
    const client = await clienteComVetor();

    try {
        const { rows } = await client.query(
            `INSERT INTO "Documentos" (conteudo, metadata, embedding)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [conteudo, JSON.stringify(metadata), pgvector.toSql(embedding)]
        );
        const id = rows[0].id;
        console.log(`✅ Documento inserido — id: ${id}`);
        return id;
    } finally {
        client.release();
    }
}

/**
 * Busca os K documentos mais similares à query usando distância de cosseno.
 * @param {string} query  Texto de busca
 * @param {number} k      Número máximo de resultados (padrão: 5)
 * @returns {Promise<Array<{ id, conteudo, metadata, similaridade }>>}
 */
async function buscarSimilares(query, k = 5) {
    const embedding = await gerarEmbedding(query);
    const client = await clienteComVetor();

    try {
        const { rows } = await client.query(
            `SELECT
                id,
                conteudo,
                metadata,
                -- 1 - distância_de_cosseno = similaridade (0 a 1)
                (1 - (embedding <=> $1))::FLOAT AS similaridade
             FROM "Documentos"
             ORDER BY embedding <=> $1   -- operador cosine distance do pgvector
             LIMIT $2`,
            [pgvector.toSql(embedding), k]
        );
        return rows;
    } finally {
        client.release();
    }
}

/**
 * Encerra a pool de conexões (chamar ao final do processo).
 */
async function encerrar() {
    await pool.end();
}

// ---------------------------------------------------------------------------
// Exemplo de uso (executado apenas quando rodado diretamente)
// ---------------------------------------------------------------------------
if (require.main === module) {
    (async () => {
        try {
            // --- Inserção ---
            await inserirDocumento(
                'Como faço para resetar minha senha de acesso ao sistema?',
                { categoria: 'Acesso', origem: 'base_de_conhecimento' }
            );
            await inserirDocumento(
                'Meu computador não está conectando à rede Wi-Fi da empresa.',
                { categoria: 'Rede', origem: 'base_de_conhecimento' }
            );

            // --- Busca por similaridade ---
            console.log('\n🔍 Buscando documentos similares a "esqueci minha senha"...\n');
            const resultados = await buscarSimilares('esqueci minha senha', 3);

            console.table(
                resultados.map(r => ({
                    id: r.id,
                    similaridade: Number(r.similaridade).toFixed(4),
                    conteudo: r.conteudo.substring(0, 70),
                }))
            );
        } catch (err) {
            console.error('❌ Erro:', err.message);
        } finally {
            await encerrar();
        }
    })();
}

module.exports = { gerarEmbedding, inserirDocumento, buscarSimilares, encerrar };

