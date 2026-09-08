-- Bregenz Barbershop — Schema (info.md §17)
-- Alle Zeitstempel als timestamptz; die Geschäftszeitzone steht in business.timezone.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role      AS ENUM ('OWNER', 'ADMIN', 'EMPLOYEE', 'CLIENT');
  CREATE TYPE entity_status  AS ENUM ('ACTIVE', 'INACTIVE');
  CREATE TYPE booking_status AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');
  CREATE TYPE booking_source AS ENUM ('WEBSITE', 'MANUAL');
  CREATE TYPE absence_kind   AS ENUM ('VACATION', 'SICK', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS business (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  timezone    text        NOT NULL DEFAULT 'Europe/Vienna',
  address     text        NOT NULL,
  phone       text        NOT NULL,
  email       text        NOT NULL,
  instagram   text,
  slot_step_minutes integer NOT NULL DEFAULT 15,   -- Raster für Slot-Vorschläge
  lead_time_minutes integer NOT NULL DEFAULT 60,   -- kein Termin in der nächsten Stunde
  max_advance_days  integer NOT NULL DEFAULT 90,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  name          text NOT NULL,
  email         text NOT NULL,
  password_hash text,
  role          user_role     NOT NULL DEFAULT 'EMPLOYEE',
  status        entity_status NOT NULL DEFAULT 'ACTIVE',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS app_user_email_lower_idx ON app_user (business_id, lower(email));

CREATE TABLE IF NOT EXISTS employee (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  user_id            uuid REFERENCES app_user(id) ON DELETE SET NULL,
  name               text NOT NULL,
  role_label         text,
  status             entity_status NOT NULL DEFAULT 'ACTIVE',
  google_calendar_id text,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_business_status_idx ON employee (business_id, status);

CREATE TABLE IF NOT EXISTS service (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  slug             text NOT NULL,
  name             text NOT NULL,
  description      text,
  category         text,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  price_cents      integer NOT NULL CHECK (price_cents >= 0),
  status           entity_status NOT NULL DEFAULT 'ACTIVE',
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, slug)
);

-- Welcher Mitarbeiter darf welche Leistung? Leer = alle aktiven Mitarbeiter.
CREATE TABLE IF NOT EXISTS employee_service (
  employee_id uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  service_id  uuid NOT NULL REFERENCES service(id)  ON DELETE CASCADE,
  PRIMARY KEY (employee_id, service_id)
);

-- Arbeitszeiten je Wochentag (0 = Sonntag). Pausen als eigene Zeilen mit is_break.
CREATE TABLE IF NOT EXISTS working_hours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  is_break    boolean NOT NULL DEFAULT false,
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS working_hours_employee_idx ON working_hours (employee_id, weekday);

-- Urlaub, Krankheit, einzelne freie Tage.
CREATE TABLE IF NOT EXISTS absence (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  kind        absence_kind NOT NULL DEFAULT 'OTHER',
  note        text,
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS absence_employee_range_idx ON absence (employee_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS booking (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employee(id) ON DELETE RESTRICT,
  service_id      uuid NOT NULL REFERENCES service(id)  ON DELETE RESTRICT,
  reference       text NOT NULL,
  customer_name   text NOT NULL,
  customer_email  text,
  customer_phone  text NOT NULL,
  note            text,
  start_time      timestamptz NOT NULL,
  end_time        timestamptz NOT NULL,
  status          booking_status NOT NULL DEFAULT 'CONFIRMED',
  source          booking_source NOT NULL DEFAULT 'WEBSITE',
  google_event_id text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  UNIQUE (business_id, reference)
);
CREATE INDEX IF NOT EXISTS booking_employee_time_idx ON booking (employee_id, start_time);
CREATE INDEX IF NOT EXISTS booking_business_time_idx ON booking (business_id, start_time);

-- Doppelbuchungsschutz auf DB-Ebene: zwei aktive Buchungen desselben Mitarbeiters
-- dürfen sich zeitlich nicht überschneiden. Das ist die letzte Verteidigungslinie,
-- unabhängig davon, was die Anwendung vorher geprüft hat (info.md §16).
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$ BEGIN
  ALTER TABLE booking ADD CONSTRAINT booking_no_overlap
    EXCLUDE USING gist (
      employee_id WITH =,
      tstzrange(start_time, end_time, '[)') WITH &&
    ) WHERE (status IN ('PENDING', 'CONFIRMED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS google_integration (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  google_account_id     text,
  google_account_email  text,
  encrypted_credentials bytea,          -- AES-256-GCM, Schlüssel aus TOKEN_ENCRYPTION_KEY
  status                entity_status NOT NULL DEFAULT 'ACTIVE',
  connected_at          timestamptz,
  last_error            text,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id)
);

-- Instagram-Cache: die Website fragt nie direkt bei Instagram an (info.md §34).
CREATE TABLE IF NOT EXISTS gallery_item (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  external_id text,
  source      text NOT NULL DEFAULT 'MANUAL',  -- INSTAGRAM | MANUAL
  media_type  text NOT NULL DEFAULT 'IMAGE',   -- IMAGE | VIDEO
  src         text NOT NULL,
  thumbnail   text,
  alt         text,
  permalink   text,
  posted_at   timestamptz,
  sort_order  integer NOT NULL DEFAULT 0,
  status      entity_status NOT NULL DEFAULT 'ACTIVE',
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, external_id)
);

-- Google-Bewertungen: nur echte Rezensionen, gecached. Kein Platzhalter-Rating.
CREATE TABLE IF NOT EXISTS review (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  external_id text,
  author      text NOT NULL,
  rating      numeric(2,1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
  text        text NOT NULL,
  posted_at   timestamptz,
  status      entity_status NOT NULL DEFAULT 'ACTIVE',
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, external_id)
);
