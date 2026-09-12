/* Schema-Ergänzungen, die ohne manuelle Migration ausgerollt werden.

   db/schema.sql bleibt die Quelle der Wahrheit (npm run db:migrate) und enthält
   dieselben Anweisungen. Damit ein Deploy aber nicht davon abhängt, dass jemand
   die Migration gegen die Produktionsdatenbank laufen lässt, legen die
   betroffenen Endpunkte die neuen Spalten und Tabellen beim ersten Aufruf
   selbst an — idempotent und einmal pro Function-Instanz. */
import { query } from './db.js';

export const SCHEMA_EXTENSIONS = `
  -- Bilder aus der Verwaltung (Galerie, Mitarbeiterfotos). Auf Vercel gibt es
  -- kein beschreibbares Dateisystem; die Bilder liegen deshalb in der Datenbank.
  CREATE TABLE IF NOT EXISTS media (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id  uuid NOT NULL REFERENCES business(id) ON DELETE CASCADE,
    content_type text NOT NULL,
    bytes        bytea NOT NULL,
    byte_size    integer NOT NULL,
    width        integer,
    height       integer,
    created_at   timestamptz NOT NULL DEFAULT now()
  );

  -- Öffentliches Profil je Mitarbeiter (Slider „Das Team" auf der Startseite).
  ALTER TABLE employee ADD COLUMN IF NOT EXISTS show_on_website  boolean NOT NULL DEFAULT true;
  ALTER TABLE employee ADD COLUMN IF NOT EXISTS headline         text;
  ALTER TABLE employee ADD COLUMN IF NOT EXISTS bio              text;
  ALTER TABLE employee ADD COLUMN IF NOT EXISTS languages        text;
  ALTER TABLE employee ADD COLUMN IF NOT EXISTS experience_years integer;
  ALTER TABLE employee ADD COLUMN IF NOT EXISTS photo_media_id   uuid REFERENCES media(id) ON DELETE SET NULL;

  -- Galeriebilder aus der Verwaltung verweisen auf ihr Bild in media.
  ALTER TABLE gallery_item ADD COLUMN IF NOT EXISTS media_id uuid REFERENCES media(id) ON DELETE SET NULL;

  -- Titelbild der Startseite. Auch dieses Bild kommt aus der Verwaltung, damit
  -- auf der Website kein Bild liegt, das dort niemand austauschen kann.
  ALTER TABLE business ADD COLUMN IF NOT EXISTS hero_media_id uuid REFERENCES media(id) ON DELETE SET NULL;

  -- Eigene Schließtage (Betriebsurlaub, zusätzliche freie Tage).
  CREATE TABLE IF NOT EXISTS closure_day (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES business(id) ON DELETE CASCADE,
    day         date NOT NULL,
    label       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (business_id, day)
  );

  -- Gesetzliche Feiertage, an denen der Salon trotzdem öffnet (Schlüssel aus lib/holidays.js).
  ALTER TABLE business ADD COLUMN IF NOT EXISTS open_holidays text[] NOT NULL DEFAULT '{}';

  -- Telegram-Konten, die mit einem Verwaltungszugang verknüpft sind. Erst diese
  -- Verknüpfung macht aus einem Telegram-Start eine Anmeldung; sie entsteht nur
  -- durch einmalige Eingabe von E-Mail und Passwort in der Mini App.
  CREATE TABLE IF NOT EXISTS telegram_account (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id   uuid NOT NULL REFERENCES business(id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    telegram_id   bigint NOT NULL UNIQUE,
    username      text,
    first_name    text,
    last_name     text,
    language_code text,
    linked_at     timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz
  );
  CREATE INDEX IF NOT EXISTS telegram_account_user_idx ON telegram_account (user_id);
`;

let pending = null;

async function run() {
  try {
    await query(SCHEMA_EXTENSIONS);
  } catch (err) {
    /* Zwei Instanzen gleichzeitig: CREATE TABLE IF NOT EXISTS kann dann am
       Katalog scheitern (23505, 42P07) oder in einen Deadlock laufen (40P01).
       Der zweite Versuch sieht die fertige Tabelle. */
    if (['23505', '42P07', '42701', '40P01'].includes(err?.code)) {
      await query(SCHEMA_EXTENSIONS);
      return;
    }
    throw err;
  }
}

export function ensureSchema() {
  if (!pending) {
    pending = run().catch((err) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}
