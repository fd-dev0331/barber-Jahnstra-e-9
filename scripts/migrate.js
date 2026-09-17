/* Legt das Schema an und sperrt danach den direkten Zugriff über die Supabase
   Data API (lib/security.js). Idempotent — mehrfaches Ausführen ist unschädlich. */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './env.js';
loadEnv();

/* DDL und Seed laufen über die ungepoolte Verbindung: CREATE EXTENSION und
   andere DDL gehen über den Transaction-Pooler (PgBouncer, Port 6543) nicht
   zuverlässig durch. Nur überschreiben, wenn es eine direkte URL tatsächlich
   gibt — sonst bleibt die normale Auflösung in lib/db.js zuständig.

   Wichtig: dieselbe Rolle verwenden, mit der auch das Backend verbunden ist
   (bei Supabase: postgres). Die Sicherheitsmigration schaltet RLS nur auf
   Tabellen dieser Rolle ein — genau damit sperrt sie das Backend nicht aus. */
const directUrl =
  process.env.DATABASE_URL_NON_POOLING || process.env.POSTGRES_URL_NON_POOLING;
if (directUrl) process.env.DATABASE_URL = directUrl;
const { getPool } = await import('../lib/db.js');
const { applySecurity } = await import('../lib/security.js');

const sql = fs.readFileSync(path.resolve('db/schema.sql'), 'utf8');
const pool = getPool();
try {
  await pool.query(sql);
  console.log('✅ Schema angelegt/aktualisiert');

  const messages = await applySecurity(pool);
  for (const { severity, message } of messages) {
    console.log(`   ${severity === 'WARNING' ? '⚠️ ' : '·'} ${message}`);
  }
  const warnings = messages.filter((m) => m.severity === 'WARNING').length;
  console.log(warnings
    ? `⚠️  Sicherheitsmigration mit ${warnings} Warnung(en) — siehe oben`
    : '✅ Sicherheitsmigration (RLS, Rechte, Policies) angewendet');
} catch (err) {
  console.error('❌ Migration fehlgeschlagen:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
