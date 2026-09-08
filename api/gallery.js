/* GET /api/gallery — Bilder aus dem Backend-Cache.
   Instagram wird NIE direkt vom Browser abgefragt (info.md §33/§34); den Cache
   befüllt scripts/sync-instagram.js. Fehlt die API, liefert dieselbe Tabelle die
   manuell gepflegten Bilder — das Frontend merkt keinen Unterschied. */
import { query } from '../lib/db.js';
import { getBusiness } from '../lib/business.js';
import { json, methodNotAllowed, serverError } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const business = await getBusiness();
    const url = new URL(req.url, 'http://localhost');
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 24, 1), 60);

    const { rows } = await query(
      `SELECT src, thumbnail, alt, media_type, permalink, source
         FROM gallery_item
        WHERE business_id = $1 AND status = 'ACTIVE'
        ORDER BY sort_order, posted_at DESC NULLS LAST, fetched_at DESC
        LIMIT $2`,
      [business.id, limit]
    );

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400');
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
