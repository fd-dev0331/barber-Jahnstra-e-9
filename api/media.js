/* GET /api/media?id=<uuid> — Bild aus der Verwaltung (Galerie, Mitarbeiterfotos).

   Öffentlich, weil diese Bilder ohnehin auf der Website stehen. Eine ID gehört
   für immer zu genau einem Bild — ein neues Foto bekommt eine neue ID —, darum
   darf das Ergebnis dauerhaft gecacht werden. */
import { query } from '../lib/db.js';
import { fail, methodNotAllowed, serverError } from '../lib/http.js';
import { ensureSchema } from '../lib/schema.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, ['GET']);
  try {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    if (!id || !UUID.test(id)) return fail(res, 404, 'not_found', 'Bild nicht gefunden.');

    await ensureSchema();
    const { rows } = await query('SELECT content_type, bytes FROM media WHERE id = $1', [id]);
    if (!rows.length) return fail(res, 404, 'not_found', 'Bild nicht gefunden.');

    const { content_type: contentType, bytes } = rows[0];
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(req.method === 'HEAD' ? '' : bytes);
  } catch (err) {
    serverError(res, err);
  }
}
