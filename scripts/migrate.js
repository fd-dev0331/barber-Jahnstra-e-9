/* Legt das Schema an. Idempotent — mehrfaches Ausführen ist unschädlich. */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './env.js';
loadEnv();

/* DDL und Seed laufen über die ungepoolte Verbindung: CREATE EXTENSION und
   andere DDL gehen über den Transaction-Pooler (PgBouncer, Port 6543) nicht
   zuverlässig durch. Nur überschreiben, wenn es eine direkte URL tatsächlich
   gibt — sonst bleibt die normale Auflösung in lib/db.js zuständig. */
const directUrl =
  process.env.DATABASE_URL_NON_POOLING || process.env.POSTGRES_URL_NON_POOLING;
if (directUrl) process.env.DATABASE_URL = directUrl;
const { getPool } = await import('../lib/db.js');

const sql = fs.readFileSync(path.resolve('db/schema.sql'), 'utf8');
const pool = getPool();
try {
  await pool.query(sql);
  console.log('✅ Schema angelegt/aktualisiert');
} catch (err) {
  console.error('❌ Migration fehlgeschlagen:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
