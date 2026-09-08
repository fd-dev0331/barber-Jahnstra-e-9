/* Leistungen verwalten. Dauer und Preis kommen ausschließlich von hier — die
   Buchungsseite rechnet nichts selbst nach (info.md §15). */
import { query } from '../db.js';
import { json, fail } from '../http.js';
import { text, integer, oneOf, uuid, slugify, ValidationError } from './util.js';

function shape(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    durationMinutes: row.duration_minutes,
    priceCents: row.price_cents,
    status: row.status,
    sortOrder: row.sort_order,
    totalBookings: row.total_bookings ?? undefined,
  };
}

export async function list(req, res, user) {
  const { rows } = await query(
    `SELECT s.id, s.slug, s.name, s.description, s.category, s.duration_minutes,
            s.price_cents, s.status, s.sort_order,
            (SELECT count(*) FROM booking b WHERE b.service_id = s.id)::int AS total_bookings
       FROM service s WHERE s.business_id = $1
      ORDER BY s.status, s.sort_order, s.name`,
    [user.businessId]
  );
  json(res, 200, { services: rows.map(shape) });
}

export async function create(req, res, body, user) {
  const name = text(body.name, { required: true, min: 2, max: 120, field: 'Name' });
  const slug = text(body.slug, { max: 60, field: 'Kürzel' }) || slugify(name);
  const description = text(body.description, { max: 500, field: 'Beschreibung' });
  const category = text(body.category, { max: 120, field: 'Kategorie' });
  const duration = integer(body.durationMinutes, { min: 5, max: 480, required: true, field: 'Dauer' });
  const price = integer(body.priceCents, { min: 0, max: 1_000_000, required: true, field: 'Preis' });
  const sortOrder = integer(body.sortOrder, { min: 0, max: 9999 }) ?? 100;

  try {
    const { rows } = await query(
      `INSERT INTO service (business_id, slug, name, description, category,
                            duration_minutes, price_cents, sort_order, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE')
       RETURNING id, slug, name, description, category, duration_minutes, price_cents, status, sort_order`,
      [user.businessId, slug, name, description, category, duration, price, sortOrder]
    );
    json(res, 201, { service: shape(rows[0]) });
  } catch (err) {
    if (err?.code === '23505') {
      return fail(res, 409, 'slug_taken', 'Dieses Kürzel ist schon vergeben. Bitte wähle ein anderes.');
    }
    throw err;
  }
}

export async function update(req, res, body, user, id) {
  uuid(id, { field: 'Leistung' });

  const sets = [];
  const params = [id, user.businessId];
  const push = (column, value) => { params.push(value); sets.push(`${column} = $${params.length}`); };

  if (body.name !== undefined) push('name', text(body.name, { required: true, min: 2, max: 120, field: 'Name' }));
  if (body.slug !== undefined) push('slug', text(body.slug, { required: true, max: 60, field: 'Kürzel' }));
  if (body.description !== undefined) push('description', text(body.description, { max: 500, field: 'Beschreibung' }));
  if (body.category !== undefined) push('category', text(body.category, { max: 120, field: 'Kategorie' }));
  if (body.durationMinutes !== undefined) push('duration_minutes', integer(body.durationMinutes, { min: 5, max: 480, required: true, field: 'Dauer' }));
  if (body.priceCents !== undefined) push('price_cents', integer(body.priceCents, { min: 0, max: 1_000_000, required: true, field: 'Preis' }));
  if (body.status !== undefined) push('status', oneOf(body.status, ['ACTIVE', 'INACTIVE'], { required: true, field: 'Status' }));
  if (body.sortOrder !== undefined) push('sort_order', integer(body.sortOrder, { min: 0, max: 9999, required: true, field: 'Reihenfolge' }));

  if (!sets.length) throw new ValidationError('invalid_input', 'Es gibt nichts zu ändern.');

  try {
    const { rows } = await query(
      `UPDATE service SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $1 AND business_id = $2
        RETURNING id, slug, name, description, category, duration_minutes, price_cents, status, sort_order`,
      params
    );
    if (!rows.length) return fail(res, 404, 'not_found', 'Diese Leistung gibt es nicht.');
    json(res, 200, { service: shape(rows[0]) });
  } catch (err) {
    if (err?.code === '23505') {
      return fail(res, 409, 'slug_taken', 'Dieses Kürzel ist schon vergeben. Bitte wähle ein anderes.');
    }
    throw err;
  }
}

export async function remove(req, res, user, id) {
  uuid(id, { field: 'Leistung' });

  const { rows } = await query(
    `SELECT (SELECT count(*) FROM booking b WHERE b.service_id = s.id)::int AS bookings
       FROM service s WHERE s.id = $1 AND s.business_id = $2`,
    [id, user.businessId]
  );
  if (!rows.length) return fail(res, 404, 'not_found', 'Diese Leistung gibt es nicht.');
  if (rows[0].bookings > 0) {
    return fail(res, 409, 'has_bookings',
      'Zu dieser Leistung gibt es Termine in der Historie. Setz sie auf „inaktiv“, statt sie zu löschen.');
  }

  await query('DELETE FROM service WHERE id = $1 AND business_id = $2', [id, user.businessId]);
  json(res, 200, { ok: true });
}
