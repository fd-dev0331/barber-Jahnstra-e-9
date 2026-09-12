/* Bild-Uploads aus der Verwaltung (Galerie, Mitarbeiterfotos).

   Der Browser verkleinert das Foto vor dem Hochladen; hier wird trotzdem alles
   geprüft: Größe, und ob die Bytes wirklich JPEG, PNG oder WebP sind — die
   Angabe des Browsers zählt nicht. */
import { query } from '../db.js';
import { json, fail } from '../http.js';
import { integer, ValidationError } from './util.js';

const MAX_BYTES = 3 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const mediaUrl = (id) => (id ? `/api/media?id=${id}` : null);

/* Wo ein Bild benutzt werden kann. Wird eine weitere Stelle ergänzt, gehört sie
   hierher — sonst räumt der Upload sie beim nächsten Mal weg. */
const UNUSED = `NOT EXISTS (SELECT 1 FROM gallery_item g WHERE g.media_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM employee e WHERE e.photo_media_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM business b WHERE b.hero_media_id = m.id)`;

/** Dateityp aus den ersten Bytes, nicht aus dem Dateinamen. */
function sniff(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export async function upload(req, res, body, user) {
  if (typeof body.data !== 'string' || !body.data) {
    throw new ValidationError('invalid_image', 'Bitte ein Bild auswählen.');
  }
  const base64 = body.data.replace(/^data:[^;,]+;base64,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) {
    throw new ValidationError('invalid_image', 'Das Bild konnte nicht gelesen werden.');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > MAX_BYTES) {
    return fail(res, 413, 'image_too_large', 'Das Bild ist zu groß (höchstens 3 MB).');
  }
  const contentType = sniff(bytes);
  if (!contentType) {
    throw new ValidationError('invalid_image', 'Erlaubt sind JPEG, PNG und WebP.');
  }
  const width = integer(body.width, { min: 1, max: 20_000, field: 'Breite' });
  const height = integer(body.height, { min: 1, max: 20_000, field: 'Höhe' });

  // Nie gespeicherte Uploads (Dialog abgebrochen) nicht ewig aufheben.
  await query(
    `DELETE FROM media m
      WHERE m.business_id = $1 AND m.created_at < now() - interval '1 day'
        AND ${UNUSED}`,
    [user.businessId]
  );

  const { rows } = await query(
    `INSERT INTO media (business_id, content_type, bytes, byte_size, width, height)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, width, height`,
    [user.businessId, contentType, bytes, bytes.length, width, height]
  );
  json(res, 201, {
    media: { id: rows[0].id, url: mediaUrl(rows[0].id), width: rows[0].width, height: rows[0].height },
  });
}

/** Bild löschen, sobald es nirgends mehr benutzt wird. */
export async function deleteIfUnused(businessId, id) {
  if (!id) return;
  await query(
    `DELETE FROM media m WHERE m.id = $1 AND m.business_id = $2 AND ${UNUSED}`,
    [id, businessId]
  );
}

/** Gehört das Bild zu diesem Betrieb? */
export async function assertMedia(businessId, id) {
  const { rows } = await query('SELECT 1 FROM media WHERE id = $1 AND business_id = $2', [id, businessId]);
  if (!rows.length) throw new ValidationError('not_found', 'Dieses Bild gibt es nicht.');
}
