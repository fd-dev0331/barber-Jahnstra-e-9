/* GET /api/services — aktive Leistungen für die Buchungsseite. */
import { query } from '../lib/db.js';
import { getBusiness } from '../lib/business.js';
import { json, methodNotAllowed, serverError } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const business = await getBusiness();
    const { rows } = await query(
      `SELECT id, slug, name, description, duration_minutes, price_cents
         FROM service
        WHERE business_id = $1 AND status = 'ACTIVE'
        ORDER BY sort_order, name`,
      [business.id]
    );
    // Kurz gecacht: Änderungen aus der Verwaltung sollen binnen Sekunden sichtbar sein.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
    json(res, 200, {
      services: rows.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        description: s.description,
        durationMinutes: s.duration_minutes,
        priceCents: s.price_cents,
      })),
    });
  } catch (err) {
    serverError(res, err);
  }
}
