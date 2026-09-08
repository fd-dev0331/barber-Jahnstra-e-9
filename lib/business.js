/* Der Betrieb ist derzeit einer. Die Abfrage geht trotzdem über business_id,
   damit ein zweiter Standort später keine Umbauten erzwingt. */
import { query } from './db.js';

let cache = null;
let cachedAt = 0;

export async function getBusiness() {
  if (cache && Date.now() - cachedAt < 60_000) return cache;
  const { rows } = await query(
    `SELECT id, name, timezone, address, phone, email, instagram,
            slot_step_minutes, lead_time_minutes, max_advance_days
       FROM business ORDER BY created_at LIMIT 1`
  );
  if (!rows.length) throw new Error('Kein Betrieb in der Datenbank — bitte "npm run db:seed" ausführen');
  cache = rows[0];
  cachedAt = Date.now();
  return cache;
}
