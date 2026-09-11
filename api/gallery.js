/* GET /api/gallery — Bilder aus dem Backend-Cache.
   Instagram wird NIE direkt vom Browser abgefragt (info.md §33/§34); den Cache
   befüllt scripts/sync-instagram.js. Fehlt die API, liefert dieselbe Tabelle die
   manuell gepflegten Bilder — das Frontend merkt keinen Unterschied. */
import { query } from '../lib/db.js';
import { getBusiness } from '../lib/business.js';
import { json, methodNotAllowed, serverError } from '../lib/http.js';
import { ensureSchema } from '../lib/schema.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    await ensureSchema();
    const business = await getBusiness();
    const url = new URL(req.url, 'http://localhost');
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 24, 1), 60);

    // Bilder aus der Verwaltung zeigen über media_id auf /api/media.
    const { rows } = await query(
      `SELECT CASE WHEN media_id IS NOT NULL THEN '/api/media?id=' || media_id ELSE src END AS src,
              thumbnail, alt, media_type, permalink, source
         FROM gallery_item
        WHERE business_id = $1 AND status = 'ACTIVE'
        ORDER BY sort_order, posted_at DESC NULLS LAST, fetched_at DESC
        LIMIT $2`,
      [business.id, limit]
    );

    // Kurz gecacht: neue Bilder aus der Verwaltung sollen binnen Sekunden erscheinen.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
    json(res, 200, {
      items: rows.map((r) => ({
        src: r.src,
        thumbnail: r.thumbnail || r.src,
        alt: r.alt || 'Arbeit aus dem Bregenz Barbershop',
        type: r.media_type,
        permalink: r.permalink,
        source: r.source,
      })),
    });
  } catch (err) {
    serverError(res, err);
  }
}
