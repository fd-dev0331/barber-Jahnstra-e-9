/* GET /api/media?id=<uuid>   — Bild aus der Verwaltung (Galerie, Mitarbeiterfotos)
   GET /api/media?slot=hero   — Titelbild der Startseite, ohne dessen ID zu kennen

   Öffentlich, weil diese Bilder ohnehin auf der Website stehen.

   Zwei Adressen, zwei Cache-Regeln: eine ID gehört für immer zu genau einem Bild
   — ein neues Foto bekommt eine neue ID —, deshalb darf sie dauerhaft gecacht
   werden (vercel.json setzt `immutable` nur, wenn `id` in der Adresse steht).
   Der Slot zeigt dagegen mal auf dieses, mal auf jenes Bild; er wird nur kurz
   zwischengespeichert, sonst hinge nach einem Wechsel das alte Bild fest.
   Gebraucht wird er für `og:image`: dieses Bild holen Messenger und soziale
   Netze ohne JavaScript, also muss die Adresse schon im HTML stehen. */
import { query } from '../lib/db.js';
import { fail, methodNotAllowed, serverError } from '../lib/http.js';
import { ensureSchema } from '../lib/schema.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bild-ID eines Slots. Mehr als „hero" gibt es bewusst nicht. */
async function slotMediaId(slot) {
  if (slot !== 'hero') return null;
  const { rows } = await query('SELECT hero_media_id FROM business ORDER BY created_at LIMIT 1');
  return rows[0]?.hero_media_id ?? null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, ['GET']);
  try {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const slot = params.get('slot');
    let id = params.get('id');

    await ensureSchema();

    if (!id && slot) id = await slotMediaId(slot);
    if (!id || !UUID.test(id)) return fail(res, 404, 'not_found', 'Bild nicht gefunden.');

    const { rows } = await query('SELECT content_type, bytes FROM media WHERE id = $1', [id]);
    if (!rows.length) return fail(res, 404, 'not_found', 'Bild nicht gefunden.');

    const { content_type: contentType, bytes } = rows[0];
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Cache-Control', slot && !params.get('id')
      ? 'public, max-age=0, s-maxage=60, stale-while-revalidate=300'
      : 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(req.method === 'HEAD' ? '' : bytes);
  } catch (err) {
    serverError(res, err);
  }
}
