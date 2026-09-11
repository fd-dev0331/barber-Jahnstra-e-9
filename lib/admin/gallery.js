/* Galerie der Website, gepflegt in der Verwaltung.

   gallery_item gab es schon (Instagram-Cache + manuelle Bilder). Neu hochgeladene
   Bilder liegen in media; src zeigt auf /api/media?id=…, damit die öffentliche
   Galerie keinen Unterschied zwischen den Quellen machen muss. */
import { query, withTransaction } from '../db.js';
import { json, fail } from '../http.js';
import { text, uuid, integer, oneOf, ValidationError } from './util.js';
import { mediaUrl, deleteIfUnused, assertMedia } from './media.js';

const SELECT = `SELECT id, src, media_id, alt, status, sort_order, source FROM gallery_item`;

function shape(row) {
  return {
    id: row.id,
    url: row.media_id ? mediaUrl(row.media_id) : row.src,
    mediaId: row.media_id,
    alt: row.alt,
    status: row.status,
    sortOrder: row.sort_order,
    source: row.source,
  };
}

export async function list(req, res, user) {
  const { rows } = await query(
    `${SELECT} WHERE business_id = $1 ORDER BY sort_order, posted_at DESC NULLS LAST, fetched_at DESC`,
    [user.businessId]
  );
  json(res, 200, { items: rows.map(shape) });
}

export async function create(req, res, body, user) {
  const mediaId = uuid(body.mediaId, { field: 'Bild' });
  const alt = text(body.alt, { max: 200, field: 'Beschreibung' });
  await assertMedia(user.businessId, mediaId);

  const { rows } = await query(
    `INSERT INTO gallery_item (business_id, source, media_type, src, media_id, alt, sort_order, status)
     VALUES ($1, 'MANUAL', 'IMAGE', $2, $3, $4,
             COALESCE((SELECT max(sort_order) FROM gallery_item WHERE business_id = $1), 0) + 10, 'ACTIVE')
     RETURNING id, src, media_id, alt, status, sort_order, source`,
    [user.businessId, mediaUrl(mediaId), mediaId, alt]
  );
  json(res, 201, { item: shape(rows[0]) });
}

export async function update(req, res, body, user, id) {
  uuid(id, { field: 'Bild' });
  const sets = [];
  const params = [id, user.businessId];
  const push = (column, value) => { params.push(value); sets.push(`${column} = $${params.length}`); };

  if (body.alt !== undefined) push('alt', text(body.alt, { max: 200, field: 'Beschreibung' }));
  if (body.status !== undefined) push('status', oneOf(body.status, ['ACTIVE', 'INACTIVE'], { required: true, field: 'Status' }));
  if (body.sortOrder !== undefined) push('sort_order', integer(body.sortOrder, { min: 0, max: 1_000_000, required: true, field: 'Reihenfolge' }));
  if (!sets.length) throw new ValidationError('invalid_input', 'Es gibt nichts zu ändern.');

  const { rows } = await query(
    `UPDATE gallery_item SET ${sets.join(', ')} WHERE id = $1 AND business_id = $2
     RETURNING id, src, media_id, alt, status, sort_order, source`,
    params
  );
  if (!rows.length) return fail(res, 404, 'not_found', 'Dieses Bild gibt es nicht.');
  json(res, 200, { item: shape(rows[0]) });
}

/** Neue Reihenfolge: ids in der gewünschten Abfolge. */
export async function reorder(req, res, body, user) {
  if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 500) {
    throw new ValidationError('invalid_input', 'Die Reihenfolge ist ungültig.');
  }
  const ids = body.ids.map((value) => uuid(value, { field: 'Bild' }));
  await withTransaction(async (client) => {
    for (const [index, id] of ids.entries()) {
      await client.query(
        'UPDATE gallery_item SET sort_order = $3 WHERE id = $1 AND business_id = $2',
        [id, user.businessId, (index + 1) * 10]
      );
    }
  });
  return list(req, res, user);
}

export async function remove(req, res, user, id) {
  uuid(id, { field: 'Bild' });
  const { rows } = await query(
    'DELETE FROM gallery_item WHERE id = $1 AND business_id = $2 RETURNING media_id',
    [id, user.businessId]
  );
  if (!rows.length) return fail(res, 404, 'not_found', 'Dieses Bild gibt es nicht.');
  await deleteIfUnused(user.businessId, rows[0].media_id);
  json(res, 200, { ok: true });
}
