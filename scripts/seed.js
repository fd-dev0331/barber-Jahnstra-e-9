/* Startdaten aus den bestätigten Angaben des Kunden (Treatwell-Seite, 08.09.2026).
   Enthält bewusst KEINE erfundenen Bewertungen und keine Beispiel-Mitarbeiter:
   der Salon hat genau eine Person, "Abo". */
import { loadEnv } from './env.js';
loadEnv();
const { getPool, query } = await import('../lib/db.js');

const SERVICES = [
  ['haarschnitt-augenbrauen-messer', 'Haarschnitt + Augenbrauen mit Messer', 'Schnitt und Augenbrauenkontur mit dem Messer — unser Angebot.', 'Angebote', 40, 2500, 10],
  ['haarschnitt-waschen',            'Haarschnitt + Waschen',                'Schnitt mit Haarwäsche und Styling zum Abschluss.',           'Angebote', 40, 2700, 20],
  ['gruppenrabatt',                  'Gruppenrabatt ab 5 Personen',          'Angebot für Gruppen ab fünf Personen — Preis pro Person.',    'Angebote', 30, 2000, 30],
  ['herren-haarschnitt',             'Herren – Haarschnitt',                 'Klassischer Schnitt inklusive Konturen und Finish.',          'Herren – Haarschnitte & Stylings', 30, 2500, 40],
  ['kinder-haarschnitt',             'Kinder – Haarschnitt bis 10 Jahre',    'Für die Kleinen, in Ruhe und ohne Hektik.',                   'Herren – Haarschnitte & Stylings', 15, 1800, 50],
  ['herren-haare-waschen',           'Herren – Haare waschen',               'Haarwäsche mit Kopfmassage.',                                 'Herren – Haarschnitte & Stylings', 10,  500, 60],
  ['herren-bart',                    'Herren – Bart',                        'Bartschnitt, Kontur und Pflege.',                             'Herren – Haarschnitte & Stylings', 15, 1500, 70],
  ['herren-augenbrauen-messer',      'Herren – Augenbrauen mit Messer',      'Präzise Augenbrauenkontur mit dem Messer.',                   'Herren – Haarschnitte & Stylings', 10,  500, 80],
  ['herren-augenbrauen-faden',       'Herren – Augenbrauen mit Faden',       'Augenbrauen zupfen mit der Fadentechnik.',                    'Herren – Haarschnitte & Stylings', 10,  500, 90],
];

const pool = getPool();
try {
  const { rows: existing } = await query('SELECT id FROM business LIMIT 1');
  let businessId = existing[0]?.id;

  if (!businessId) {
    const { rows } = await query(
      `INSERT INTO business (name, timezone, address, phone, email, instagram)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      ['Bregenz Barbershop', 'Europe/Vienna', 'Jahnstraße 9, 6900 Bregenz',
       '+436812039790', 'abdulrahmanhamrawe1994@gmail.com',
       'https://www.instagram.com/bregenz_barbershop/']
    );
    businessId = rows[0].id;
    console.log('• Betrieb angelegt');
  }

  for (const [slug, name, description, category, duration, price, order] of SERVICES) {
    await query(
      `INSERT INTO service (business_id, slug, name, description, category, duration_minutes, price_cents, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (business_id, slug) DO UPDATE
         SET name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category,
             duration_minutes = EXCLUDED.duration_minutes, price_cents = EXCLUDED.price_cents,
             sort_order = EXCLUDED.sort_order, updated_at = now()`,
      [businessId, slug, name, description, category, duration, price, order]
    );
  }
  console.log(`• ${SERVICES.length} Leistungen angelegt/aktualisiert`);

  const { rows: emp } = await query(
    `SELECT id FROM employee WHERE business_id = $1 AND name = 'Abo'`, [businessId]
  );
  let employeeId = emp[0]?.id;
  if (!employeeId) {
    const { rows } = await query(
      `INSERT INTO employee (business_id, name, role_label, status, sort_order)
       VALUES ($1, 'Abo', 'Inhaber & Barbier', 'ACTIVE', 10) RETURNING id`,
      [businessId]
    );
    employeeId = rows[0].id;
    console.log('• Mitarbeiter "Abo" angelegt');
  }

  // Öffnungszeiten laut Treatwell-Seite: Mo–Fr 09–19, Sa 09–18, So geschlossen.
  await query('DELETE FROM working_hours WHERE employee_id = $1', [employeeId]);
  for (const weekday of [1, 2, 3, 4, 5]) {
    await query(
      `INSERT INTO working_hours (employee_id, weekday, start_time, end_time) VALUES ($1,$2,'09:00','19:00')`,
      [employeeId, weekday]
    );
  }
  await query(
    `INSERT INTO working_hours (employee_id, weekday, start_time, end_time) VALUES ($1,6,'09:00','18:00')`,
    [employeeId]
  );
  console.log('• Arbeitszeiten Mo–Fr 09:00–19:00, Sa 09:00–18:00, So geschlossen');
  console.log('  Hinweis: Pausen sind nicht hinterlegt — der Kunde muss sie bestätigen.');
  console.log('  (INSERT INTO working_hours (..., is_break) VALUES (..., true))');

  console.log('\n✅ Seed abgeschlossen.');
  console.log('   Keine Bewertungen und keine Galeriebilder angelegt — beides kommt');
  console.log('   ausschließlich aus echten Quellen (Google Business / Instagram).');
} catch (err) {
  console.error('❌ Seed fehlgeschlagen:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
