/* Befund der Datenbank-Sicherheit — nur lesend, auch gegen Produktion.

   Aufruf:
     node scripts/db-security-check.js
   mit derselben Verbindung wie das Backend (DATABASE_URL oder POSTGRES_URL,
   bei Supabase die Werte aus den Vercel-Umgebungsvariablen).

   Läuft vollständig in einer READ ONLY-Transaktion: das Skript kann nichts
   ändern, selbst wenn es wollte. Es beantwortet die Fragen, die sich ohne
   Zugang zur Datenbank nicht klären lassen:
     · Mit welcher Rolle arbeitet das Backend, hat sie BYPASSRLS?
     · Gehören die Tabellen dieser Rolle (dann trifft RLS das Backend nicht)?
     · Ist RLS an, welche Policies gibt es?
     · Was dürfen anon und authenticated — also jeder mit dem anon-Key?
     · Gibt es Views, SECURITY DEFINER-Funktionen, Erweiterungen in public? */
import { loadEnv } from './env.js';

loadEnv();

const { getPool } = await import('../lib/db.js');

const CLIENT_ROLES = ['anon', 'authenticated'];
const yes = (v) => (v ? 'ja' : 'nein');

function table(rows, columns) {
  const widths = columns.map(([key, label]) =>
    Math.max(label.length, ...rows.map((r) => String(r[key] ?? '').length)));
  const line = (cells) => `  ${cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ')}`;
  console.log(line(columns.map(([, label]) => label)));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) console.log(line(columns.map(([key]) => row[key])));
}

const pool = getPool();
const client = await pool.connect();
let exposed = 0;
let lockout = 0;
try {
  await client.query('BEGIN READ ONLY');

  const { rows: [me] } = await client.query(
    `SELECT current_user AS name, rolsuper, rolbypassrls, current_database() AS db,
            split_part(version(), ' ', 2) AS version
       FROM pg_roles WHERE rolname = current_user`
  );
  const { rows: clientRoles } = await client.query(
    `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = ANY($1)`, [[...CLIENT_ROLES, 'service_role']]
  );
  const present = clientRoles.map((r) => r.rolname);

  console.log('\nDATENBANK');
  console.log(`  Datenbank ${me.db}, PostgreSQL ${me.version}`);
  console.log(`  Backend-Rolle: ${me.name} · Superuser ${yes(me.rolsuper)} · BYPASSRLS ${yes(me.rolbypassrls)}`);
  console.log(`  Supabase-Rollen vorhanden: ${present.join(', ') || '— (kein Supabase)'}`);

  const { rows: tables } = await client.query(
    `SELECT c.relname AS name,
            pg_get_userbyid(c.relowner) AS owner,
            pg_has_role(current_user, c.relowner, 'USAGE') AS own,
            c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
            (SELECT string_agg(p.polname || CASE WHEN p.polpermissive THEN '' ELSE '(R)' END, ', ' ORDER BY p.polname)
               FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
       FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`
  );

  const privileges = async (role, oid) => {
    if (!present.includes(role)) return '—';
    const { rows: [p] } = await client.query(
      `SELECT has_table_privilege($1, $2::oid, 'SELECT') AS s, has_table_privilege($1, $2::oid, 'INSERT') AS i,
              has_table_privilege($1, $2::oid, 'UPDATE') AS u, has_table_privilege($1, $2::oid, 'DELETE') AS d`,
      [role, oid]
    );
    return ['s', 'i', 'u', 'd'].map((k) => (p[k] ? k.toUpperCase() : '·')).join('');
  };

  for (const t of tables) {
    const { rows: [{ oid }] } = await client.query(`SELECT ('public.' || quote_ident($1))::regclass::oid AS oid`, [t.name]);
    t.anon = await privileges('anon', oid);
    t.authenticated = await privileges('authenticated', oid);
    const open = /[SIUD]/.test(`${t.anon}${t.authenticated}`);
    // Offen ist eine Tabelle, wenn eine Data-API-Rolle ein Recht hat und RLS sie nicht sperrt.
    if (open && !t.rls) exposed += 1;
    // Das Backend wäre betroffen, wenn RLS an ist und die Rolle weder Eigentümer noch BYPASSRLS ist.
    if (t.rls && !(t.own && !t.force) && !me.rolbypassrls && !me.rolsuper) lockout += 1;
    t.rlsText = t.rls ? (t.force ? 'an+FORCE' : 'an') : 'AUS';
    t.ownText = t.own ? `${t.owner} (Backend)` : t.owner;
  }

  console.log('\nTABELLEN  (Rechte: S=SELECT I=INSERT U=UPDATE D=DELETE, (R)=restriktive Policy)');
  table(tables, [
    ['name', 'Tabelle'], ['rlsText', 'RLS'], ['anon', 'anon'], ['authenticated', 'authenticated'],
    ['ownText', 'Eigentümer'], ['policies', 'Policies'],
  ]);

  const { rows: defaults } = await client.query(
    `SELECT pg_get_userbyid(d.defaclrole) AS fuer, coalesce(n.nspname, '(global)') AS schema,
            d.defaclobjtype AS typ, r.rolname AS empfaenger
       FROM pg_default_acl d
       LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
       CROSS JOIN LATERAL aclexplode(d.defaclacl) a
       JOIN pg_roles r ON r.oid = a.grantee
      WHERE r.rolname = ANY($1)
      ORDER BY 1, 2, 3`,
    [CLIENT_ROLES]
  );
  console.log('\nDEFAULT PRIVILEGES für anon/authenticated (künftige Objekte)');
  if (defaults.length) table(defaults, [['fuer', 'erstellt von'], ['schema', 'Schema'], ['typ', 'Typ'], ['empfaenger', 'bekommt']]);
  else console.log('  keine');

  const { rows: views } = await client.query(
    `SELECT c.relname, c.relkind,
            coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_invoker'), 'false') AS invoker
       FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm')`
  );
  console.log('\nVIEWS in public');
  console.log(views.length ? views.map((v) => `  ${v.relname} (security_invoker=${v.invoker})`).join('\n') : '  keine');

  const { rows: definer } = await client.query(
    `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.proconfig
       FROM pg_proc p
       LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
      WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND d.objid IS NULL`
  );
  console.log('\nSECURITY DEFINER-Funktionen in public (ohne Erweiterungen)');
  console.log(definer.length ? definer.map((f) => `  ${f.proname} (owner ${f.owner}, config ${f.proconfig ?? '—'})`).join('\n') : '  keine');

  const { rows: extensions } = await client.query(
    `SELECT e.extname, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE n.nspname = 'public' ORDER BY 1`
  );
  console.log('\nERWEITERUNGEN in public');
  console.log(extensions.length ? `  ${extensions.map((e) => e.extname).join(', ')}` : '  keine');

  await client.query('ROLLBACK');
} finally {
  client.release();
  await pool.end();
}

console.log('\nERGEBNIS');
console.log(exposed
  ? `  ❌ ${exposed} Tabelle(n) über die Data API erreichbar (Recht für anon/authenticated, RLS aus).`
  : '  ✅ Keine Tabelle über die Data API erreichbar.');
console.log(lockout
  ? `  ❌ ${lockout} Tabelle(n) mit RLS, auf die das Backend selbst keinen freien Zugriff hat.`
  : '  ✅ Das Backend ist von RLS nicht betroffen (Eigentümer oder BYPASSRLS).');
console.log('');
process.exitCode = exposed || lockout ? 1 : 0;
