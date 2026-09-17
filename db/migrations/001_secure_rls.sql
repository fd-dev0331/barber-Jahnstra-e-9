-- 001_secure_rls.sql — Zugriffssperre für die Supabase Data API
--
-- Quelle: lib/security.js (SECURITY_SQL). Diese Datei ist eine wörtliche Kopie,
-- damit die Migration ohne Node lesbar und im Supabase SQL Editor ausführbar ist.
-- scripts/test-db-security.js prüft, dass beide übereinstimmen.
--
-- Wird automatisch angewendet:
--   · npm run db:migrate            (nach db/schema.sql)
--   · zur Laufzeit über ensureSchema (lib/schema.js), einmal je Function-Instanz
--
-- Manuell (z. B. Supabase SQL Editor): als die Rolle ausführen, mit der das
-- Backend verbunden ist — bei Supabase ist das postgres. Tabellen anderer
-- Eigentümer werden übersprungen und mit WARNING gemeldet.
--
-- Idempotent. Löscht keine Tabellen, Daten, Spalten oder Fremdschlüssel.

DO $secure_rls$
DECLARE
  client_roles text[];
  role_list    text;
  item         record;
  columns      text;
  changes      int := 0;
BEGIN
  -- Rollen der Supabase Data API. Außerhalb von Supabase (lokales Postgres)
  -- gibt es sie nicht; dann wird nur RLS eingeschaltet.
  SELECT coalesce(array_agg(rolname ORDER BY rolname), '{}')
    INTO client_roles
    FROM pg_roles WHERE rolname IN ('anon', 'authenticated');
  SELECT string_agg(quote_ident(r), ', ') INTO role_list FROM unnest(client_roles) AS r;

  FOR item IN
    SELECT c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
           pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
     ORDER BY c.relname
  LOOP
    IF NOT pg_has_role(current_user, item.owner, 'USAGE') THEN
      RAISE WARNING 'secure_rls: % übersprungen – gehört %, nicht %', item.relname, item.owner, current_user;
      CONTINUE;
    END IF;

    -- 1. RLS (nur Tabellen; Views und Sequenzen kennen keine Zeilenrichtlinien)
    IF item.relkind IN ('r', 'p') THEN
      IF item.relforcerowsecurity THEN
        RAISE WARNING 'secure_rls: % hat FORCE ROW LEVEL SECURITY – bleibt unverändert', item.relname;
      ELSIF NOT item.relrowsecurity THEN
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.relname);
        RAISE NOTICE 'secure_rls: RLS eingeschaltet auf %', item.relname;
        changes := changes + 1;
      END IF;
    END IF;

    -- 2. Rechte entziehen – nur wenn tatsächlich welche bestehen, damit ein
    --    wiederholter Lauf keine Sperren nimmt. relacl ist NULL, solange nie
    --    ein Recht vergeben wurde; aclexplode(NULL) liefert dann keine Zeile
    --    (ein leeres '{}' als Ersatz wäre ein Fehler).
    IF item.relkind = 'S' THEN
      IF EXISTS (SELECT 1 FROM unnest(client_roles) r
                  WHERE has_sequence_privilege(r, item.oid, 'USAGE, SELECT, UPDATE'))
         OR EXISTS (SELECT 1 FROM pg_class pc, aclexplode(pc.relacl) a
                     WHERE pc.oid = item.oid AND a.grantee = 0) THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC%s', item.relname,
                       CASE WHEN role_list IS NULL THEN '' ELSE ', ' || role_list END);
        RAISE NOTICE 'secure_rls: Rechte entzogen auf Sequenz %', item.relname;
        changes := changes + 1;
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM unnest(client_roles) r
                  WHERE has_table_privilege(r, item.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                     OR has_any_column_privilege(r, item.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
         OR EXISTS (SELECT 1 FROM pg_class pc, aclexplode(pc.relacl) a
                     WHERE pc.oid = item.oid AND a.grantee = 0) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC%s', item.relname,
                       CASE WHEN role_list IS NULL THEN '' ELSE ', ' || role_list END);
        -- Spaltenrechte hängen nicht an der Tabelle und fallen mit REVOKE ALL nicht weg.
        SELECT string_agg(quote_ident(attname), ', ') INTO columns
          FROM pg_attribute WHERE attrelid = item.oid AND attnum > 0 AND NOT attisdropped;
        IF columns IS NOT NULL THEN
          EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM PUBLIC%s', columns, item.relname,
                         CASE WHEN role_list IS NULL THEN '' ELSE ', ' || role_list END);
        END IF;
        RAISE NOTICE 'secure_rls: Rechte von anon/authenticated/PUBLIC entzogen auf %', item.relname;
        changes := changes + 1;
      END IF;
    END IF;

    -- 3. Restriktive Sperre für die Data-API-Rollen
    IF item.relkind IN ('r', 'p') AND role_list IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = item.oid AND polname = 'deny_data_api') THEN
      BEGIN
        EXECUTE format(
          'CREATE POLICY deny_data_api ON public.%I AS RESTRICTIVE FOR ALL TO %s USING (false) WITH CHECK (false)',
          item.relname, role_list);
        RAISE NOTICE 'secure_rls: Policy deny_data_api angelegt auf %', item.relname;
        changes := changes + 1;
      EXCEPTION WHEN duplicate_object THEN
        NULL; -- zwei Instanzen gleichzeitig: die andere war schneller
      END;
    END IF;
  END LOOP;

  -- 4. Künftige Tabellen und Sequenzen dieser Rolle ohne Rechte für die Data API.
  --    Supabase legt diese Voreinstellung schemabezogen an; global geprüft wird
  --    trotzdem, falls jemand sie ohne IN SCHEMA gesetzt hat.
  IF role_list IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
                WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                  AND d.defaclnamespace = 'public'::regnamespace
                  AND d.defaclobjtype = 'r'
                  AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname = ANY (client_roles))) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %s', role_list);
      RAISE NOTICE 'secure_rls: Default Privileges für Tabellen in public entzogen';
      changes := changes + 1;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
                WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                  AND d.defaclnamespace = 'public'::regnamespace
                  AND d.defaclobjtype = 'S'
                  AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname = ANY (client_roles))) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %s', role_list);
      RAISE NOTICE 'secure_rls: Default Privileges für Sequenzen in public entzogen';
      changes := changes + 1;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
                WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                  AND d.defaclnamespace = 0
                  AND d.defaclobjtype IN ('r', 'S')
                  AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname = ANY (client_roles))) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM %s', role_list);
      EXECUTE format('ALTER DEFAULT PRIVILEGES REVOKE ALL ON SEQUENCES FROM %s', role_list);
      RAISE NOTICE 'secure_rls: globale Default Privileges entzogen';
      changes := changes + 1;
    END IF;
  END IF;

  IF changes > 0 THEN
    RAISE NOTICE 'secure_rls: % Änderung(en) als %', changes, current_user;
  END IF;
END
$secure_rls$;
