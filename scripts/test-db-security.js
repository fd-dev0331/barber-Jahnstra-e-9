/* Datenbank-Sicherheit: RLS, Rechte und Policies gegen die Supabase Data API.

   Aufruf (gegen eine Supabase-ähnliche Testdatenbank, NICHT gegen Produktion):
     DATABASE_URL=postgresql://<backend-rolle>@localhost:5434/barbershop \
     SECURITY_TEST_ADMIN_URL=postgresql://postgres@localhost:5434/barbershop \
     node scripts/test-db-security.js

   DATABASE_URL        die Rolle, mit der das Backend verbunden ist (Eigentümer der Tabellen)
   SECURITY_TEST_ADMIN_URL  eine Rolle, die SET ROLE anon/authenticated darf (Superuser)

   Die Datenbank muss die Supabase-Rollen `anon` und `authenticated` kennen.
   Geschrieben wird nur in Transaktionen, die zurückgerollt werden, plus eine
   Probetabelle, die am Ende wieder gelöscht wird. Trotzdem: nur lokal. Ein
   entfernter Host wird abgelehnt, außer SECURITY_TEST_ALLOW_REMOTE=1 ist gesetzt.

   Für den Befund in Produktion ohne jede Änderung: scripts/db-security-check.js. */
import fs from 'node:fs';
import pg from 'pg';
import { loadEnv } from './env.js';

loadEnv();

const BACKEND_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.SECURITY_TEST_ADMIN_URL;

const TABLES = [
  'absence', 'app_session', 'app_user', 'booking', 'business', 'closure_day', 'employee',
  'employee_service', 'gallery_item', 'google_integration', 'media', 'review', 'service',
  'telegram_account', 'working_hours',
];
const SENSITIVE = ['app_user', 'app_session', 'google_integration', 'telegram_account', 'absence', 'booking'];
const CLIENT_ROLES = ['anon', 'authenticated'];

let pass = 0;
let fail = 0;
function check(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label} ${detail}`); }
}

function isLocal(url) {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

function client(url) {
  const u = new URL(url);
  u.searchParams.delete('sslmode');
  return new pg.Client({ connectionString: u.toString(), ssl: isLocal(url) ? false : { rejectUnauthorized: false } });
}

/** Führt fn in einer Transaktion aus und rollt immer zurück. */
async function inRollback(db, fn) {
  await db.query('BEGIN');
  try {
    return await fn();
  } finally {
    await db.query('ROLLBACK');
  }
}

/** Fehlercode eines Statements, oder null wenn es durchging. Immer zurückgerollt. */
async function attempt(db, role, sql) {
  await db.query('BEGIN');
  try {
    await db.query(`SET LOCAL ROLE ${role}`);
    await db.query(sql);
    return null;
  } catch (err) {
    return err.code ?? 'error';
  } finally {
    await db.query('ROLLBACK');
  }
}

async function main() {
  if (!BACKEND_URL || !ADMIN_URL) {
    console.log('\n  DATABASE_URL (Backend-Rolle) und SECURITY_TEST_ADMIN_URL (Superuser) werden gebraucht.');
    console.log('  Anleitung: README.md, Abschnitt „Datenbank-Sicherheit".\n');
    process.exit(1);
  }
  if ((!isLocal(BACKEND_URL) || !isLocal(ADMIN_URL)) && process.env.SECURITY_TEST_ALLOW_REMOTE !== '1') {
    console.log('\n  Abgelehnt: dieser Test schreibt (zurückgerollt) und legt eine Probetabelle an.');
    console.log('  Er läuft nur gegen localhost. Für Produktion: node scripts/db-security-check.js\n');
    process.exit(1);
  }

  const backend = client(BACKEND_URL);
  const admin = client(ADMIN_URL);
  await backend.connect();
  await admin.connect();

  const notices = [];
  backend.on('notice', (msg) => notices.push({ severity: msg.severity, message: msg.message }));

  try {
    const { rows: [me] } = await backend.query(
      `SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`
    );
    const { rows: roles } = await admin.query(
      `SELECT rolname FROM pg_roles WHERE rolname = ANY($1)`, [CLIENT_ROLES]
    );
    console.log(`\nDatenbank-Sicherheit · Backend-Rolle „${me.name}" (superuser=${me.rolsuper}, bypassrls=${me.rolbypassrls})\n`);
    if (roles.length !== CLIENT_ROLES.length) {
      console.log('  Die Rollen anon/authenticated fehlen — das ist keine Supabase-ähnliche Datenbank.\n');
      process.exit(1);
    }
    if (me.rolsuper) {
      console.log('  Hinweis: die Backend-Rolle ist Superuser und umgeht RLS ohnehin.');
      console.log('  Aussagekräftig ist der Test mit einer Rolle ohne Superuser (wie postgres bei Supabase).\n');
    }

    const { SECURITY_SQL } = await import('../lib/security.js');

    console.log('1) Migration');
    const file = fs.readFileSync('db/migrations/001_secure_rls.sql', 'utf8');
    check('db/migrations/001_secure_rls.sql entspricht lib/security.js', file.endsWith(SECURITY_SQL));

    notices.length = 0;
    await backend.query(SECURITY_SQL);
    const firstWarnings = notices.filter((n) => n.severity === 'WARNING');
    check('Migration läuft als Backend-Rolle ohne Warnung', !firstWarnings.length,
      firstWarnings.map((n) => n.message).join(' | '));

    notices.length = 0;
    const started = Date.now();
    await backend.query(SECURITY_SQL);
    check(`Zweiter Lauf ändert nichts (idempotent, ${Date.now() - started} ms)`, notices.length === 0,
      notices.map((n) => n.message).join(' | '));

    console.log('\n2) Zustand je Tabelle');
    const { rows: state } = await admin.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner,
              EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'deny_data_api'
                        AND NOT p.polpermissive
                        AND p.polroles @> ARRAY(SELECT oid FROM pg_roles WHERE rolname = ANY($2))) AS deny_policy,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND p.polpermissive
                 AND (p.polroles && ARRAY(SELECT oid FROM pg_roles WHERE rolname = ANY($2)) OR 0 = ANY (p.polroles)))::int AS permissive_for_clients
         FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname = ANY($1)`,
      [TABLES, CLIENT_ROLES]
    );
    const byName = Object.fromEntries(state.map((r) => [r.relname, r]));
    for (const table of TABLES) {
      const row = byName[table];
      if (!row) { check(`${table}: Tabelle vorhanden`, false); continue; }
      check(`${table}: RLS an, nicht FORCE, gehört ${me.name}, restriktive Sperre, keine öffnende Policy`,
        row.relrowsecurity && !row.relforcerowsecurity && row.owner === me.name && row.deny_policy
          && row.permissive_for_clients === 0,
        JSON.stringify(row));
    }

    console.log('\n3) Rechte der Data-API-Rollen');
    const { rows: grants } = await admin.query(
      `SELECT r.rolname, c.relname, c.relkind
         FROM pg_class c CROSS JOIN pg_roles r
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
          AND r.rolname = ANY($1)
          AND CASE WHEN c.relkind = 'S'
                   THEN has_sequence_privilege(r.oid, c.oid, 'USAGE, SELECT, UPDATE')
                   ELSE has_table_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                        OR has_any_column_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES') END`,
      [CLIENT_ROLES]
    );
    check('anon und authenticated haben auf nichts in public ein Recht (Tabellen, Spalten, Views, Sequenzen)',
      grants.length === 0, grants.map((g) => `${g.rolname}:${g.relname}`).join(', '));

    const { rows: defaults } = await admin.query(
      `SELECT d.defaclobjtype, r.rolname
         FROM pg_default_acl d, aclexplode(d.defaclacl) a JOIN pg_roles r ON r.oid = a.grantee
        WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = $1) AND r.rolname = ANY($2)`,
      [me.name, CLIENT_ROLES]
    );
    check('Künftige Tabellen des Backends bekommen keine Rechte für anon/authenticated',
      defaults.length === 0, JSON.stringify(defaults));

    console.log('\n4) Verhalten: anon und authenticated (wie PostgREST mit anon-Key bzw. Login)');
    for (const role of CLIENT_ROLES) {
      const denied = { SELECT: 0, INSERT: 0, UPDATE: 0, DELETE: 0 };
      const leaks = [];
      for (const table of TABLES) {
        const { rows: [col] } = await admin.query(
          `SELECT quote_ident(attname) AS name FROM pg_attribute
            WHERE attrelid = ('public.' || quote_ident($1))::regclass AND attnum > 0 AND NOT attisdropped
            ORDER BY attnum LIMIT 1`, [table]
        );
        const statements = {
          SELECT: `SELECT * FROM public.${table} LIMIT 1`,
          INSERT: `INSERT INTO public.${table} DEFAULT VALUES`,
          UPDATE: `UPDATE public.${table} SET ${col.name} = ${col.name}`,
          DELETE: `DELETE FROM public.${table}`,
        };
        for (const [op, sql] of Object.entries(statements)) {
          const code = await attempt(admin, role, sql);
          if (code === '42501') denied[op] += 1;
          else leaks.push(`${op} ${table} → ${code ?? 'durchgegangen'}`);
        }
      }
      for (const op of Object.keys(denied)) {
        check(`${role}: ${op} auf allen ${TABLES.length} Tabellen verweigert`, denied[op] === TABLES.length,
          leaks.filter((l) => l.startsWith(op)).join(', '));
      }
    }

    for (const table of SENSITIVE) {
      const code = await attempt(admin, 'anon', `SELECT count(*) FROM public.${table}`);
      check(`anon: ${table} lesen → permission denied`, code === '42501', `(${code})`);
    }

    console.log('\n5) Tiefe Verteidigung: Fehlkonfiguration öffnet trotzdem nichts');
    const leaked = await inRollback(admin, async () => {
      await admin.query('GRANT SELECT ON public.app_user TO anon');
      await admin.query('CREATE POLICY oops_open ON public.app_user FOR SELECT TO anon USING (true)');
      await admin.query('SET LOCAL ROLE anon');
      const { rows } = await admin.query('SELECT count(*)::int AS n FROM public.app_user');
      return rows[0].n;
    });
    check('Auch mit GRANT + „USING (true)"-Policy sieht anon keine Zeile aus app_user (restriktive Sperre)',
      leaked === 0, `(${leaked} Zeilen)`);

    console.log('\n6) Backend arbeitet unverändert');
    for (const table of TABLES) {
      try {
        await backend.query(`SELECT count(*) FROM public.${table}`);
        check(`Backend liest ${table}`, true);
      } catch (err) {
        check(`Backend liest ${table}`, false, err.message);
      }
    }
    const writes = await inRollback(backend, async () => {
      const { rows: [biz] } = await backend.query('SELECT id FROM business LIMIT 1');
      const inserted = await backend.query(
        `INSERT INTO closure_day (business_id, day, label) VALUES ($1, '2099-12-31', 'rls-probe') RETURNING id`, [biz.id]
      );
      const updated = await backend.query('UPDATE booking SET updated_at = updated_at');
      const sessions = await backend.query('UPDATE app_session SET last_seen_at = last_seen_at');
      const deleted = await backend.query('DELETE FROM closure_day WHERE id = $1', [inserted.rows[0].id]);
      return { inserted: inserted.rowCount, updated: updated.rowCount, sessions: sessions.rowCount, deleted: deleted.rowCount };
    });
    check('Backend schreibt: INSERT, UPDATE, DELETE (zurückgerollt)',
      writes.inserted === 1 && writes.deleted === 1, JSON.stringify(writes));
    // RLS darf das Backend nicht auf einen Teil der Zeilen beschränken.
    const counts = {};
    for (const table of ['booking', 'app_user', 'app_session', 'employee']) {
      const [{ rows: [b] }, { rows: [a] }] = await Promise.all([
        backend.query(`SELECT count(*)::int AS n FROM public.${table}`),
        admin.query(`SELECT count(*)::int AS n FROM public.${table}`),
      ]);
      counts[table] = [b.n, a.n];
    }
    check('Backend sieht alle Zeilen (gleiche Anzahl wie Superuser)',
      Object.values(counts).every(([b, a]) => b === a) && writes.updated === counts.booking[1], JSON.stringify(counts));

    console.log('\n7) Tabellen, die erst zur Laufzeit entstehen');
    const probe = await inRollback(backend, async () => {
      await backend.query('CREATE TABLE public.zz_rls_probe (id int)');
      const { rows: [before] } = await backend.query(
        `SELECT has_table_privilege('anon', 'public.zz_rls_probe', 'SELECT') AS anon_select`
      );
      notices.length = 0;
      await backend.query(SECURITY_SQL);
      const { rows: [after] } = await backend.query(
        `SELECT c.relrowsecurity,
                EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = c.oid AND polname = 'deny_data_api') AS policy
           FROM pg_class c WHERE c.oid = 'public.zz_rls_probe'::regclass`
      );
      return { anonSelectBefore: before.anon_select, ...after };
    });
    check('Neue Tabelle bekommt anon nicht automatisch (Default Privileges)', probe.anonSelectBefore === false,
      JSON.stringify(probe));
    check('Erneuter Lauf (wie ensureSchema) schaltet RLS und Sperre ein', probe.relrowsecurity && probe.policy,
      JSON.stringify(probe));

    // Eine Tabelle, auf die nie ein Recht vergeben wurde, hat relacl = NULL. So
    // entsteht sie auf einem Postgres ohne Supabase-Voreinstellungen — daran
    // scheiterte eine frühere Fassung der Migration.
    await admin.query('CREATE TABLE IF NOT EXISTS public.zz_null_acl_probe (id int)');
    try {
      await admin.query(`ALTER TABLE public.zz_null_acl_probe OWNER TO ${me.name}`);
      const { rows: [before] } = await admin.query(
        `SELECT relacl IS NULL AS acl_null FROM pg_class WHERE oid = 'public.zz_null_acl_probe'::regclass`
      );
      let error = null;
      try {
        await backend.query(SECURITY_SQL);
      } catch (err) {
        error = err.message;
      }
      const { rows: [after] } = await admin.query(
        `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.zz_null_acl_probe'::regclass`
      );
      check('Tabelle ohne je vergebene Rechte (relacl NULL): Migration läuft und schaltet RLS ein',
        before.acl_null && !error && after.relrowsecurity, JSON.stringify({ ...before, error, ...after }));
    } finally {
      await admin.query('DROP TABLE IF EXISTS public.zz_null_acl_probe');
    }

    console.log('\n8) Sicherheitsnetz: fremde Tabellen werden nicht angefasst');
    await admin.query('CREATE TABLE IF NOT EXISTS public.zz_foreign_probe (id int)');
    try {
      notices.length = 0;
      await backend.query(SECURITY_SQL);
      const warned = notices.some((n) => n.severity === 'WARNING' && n.message.includes('zz_foreign_probe'));
      const { rows: [foreign] } = await admin.query(
        `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.zz_foreign_probe'::regclass`
      );
      check('Tabelle eines anderen Eigentümers: übersprungen und gemeldet', warned && !foreign.relrowsecurity,
        JSON.stringify({ warned, foreign }));
    } finally {
      await admin.query('DROP TABLE IF EXISTS public.zz_foreign_probe');
    }

    console.log('\n9) Views, Funktionen, Erweiterungen');
    const { rows: views } = await admin.query(
      `SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('v', 'm')`
    );
    check('Keine Views im Schema public, die RLS umgehen könnten', views.length === 0,
      views.map((v) => v.relname).join(', '));
    const { rows: definer } = await admin.query(
      `SELECT p.proname FROM pg_proc p
         LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
        WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND d.objid IS NULL`
    );
    check('Keine SECURITY DEFINER-Funktionen des Projekts in public', definer.length === 0,
      definer.map((f) => f.proname).join(', '));
    const { rows: extensions } = await admin.query(
      `SELECT e.extname, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname IN ('pgcrypto', 'btree_gist')`
    );
    console.log(`  ℹ️  Erweiterungen: ${extensions.map((e) => `${e.extname} in ${e.nspname}`).join(', ') || '—'}`);
    const { rows: [service] } = await admin.query(
      `SELECT has_table_privilege('service_role', 'public.app_user', 'SELECT') AS select_app_user,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role') AS bypassrls`
    ).catch(() => ({ rows: [{}] }));
    console.log(`  ℹ️  service_role (serverseitiger Schlüssel, im Projekt unbenutzt): ${JSON.stringify(service)} — bewusst unverändert`);
  } finally {
    await backend.end();
    await admin.end();
  }

  console.log(`\n  ${pass} bestanden, ${fail} fehlgeschlagen\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
