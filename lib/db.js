/* Postgres-Verbindung. Ein Pool pro Lambda-Instanz; Vercel-Functions werden
   wiederverwendet, deshalb wird der Pool am Modul-Scope gecached. */
import pg from 'pg';

const { Pool } = pg;

// Preise und Dauern kommen als Integer zurück, nicht als String.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

let pool;

export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL ist nicht gesetzt');
  }
  pool = new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    // Managed Postgres (Neon/Supabase/RDS) verlangt TLS; lokal in Docker nicht.
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
  });
  return pool;
}

export function query(text, params) {
  return getPool().query(text, params);
}

/** Führt fn in einer Transaktion aus und rollt bei jedem Fehler zurück. */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
