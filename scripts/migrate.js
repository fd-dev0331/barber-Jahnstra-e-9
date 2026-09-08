/* Legt das Schema an. Idempotent — mehrfaches Ausführen ist unschädlich. */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './env.js';
loadEnv();
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
