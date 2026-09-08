/* GET /api/employees?serviceId=... — nur AKTIVE Mitarbeiter.
   Deaktivierte tauchen für Kundinnen und Kunden nirgends auf (info.md §9). */
import { query } from '../lib/db.js';
import { getBusiness } from '../lib/business.js';
import { json, methodNotAllowed, serverError } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const business = await getBusiness();
    const url = new URL(req.url, 'http://localhost');
    const serviceId = url.searchParams.get('serviceId');

    // employee_service ist eine Whitelist: ist für eine Leistung nichts
    // eingetragen, kann sie jeder aktive Mitarbeiter ausführen.
    const { rows } = await query(
      `SELECT e.id, e.name, e.role_label
         FROM employee e
        WHERE e.business_id = $1
          AND e.status = 'ACTIVE'
          AND (
            $2::uuid IS NULL
            OR NOT EXISTS (SELECT 1 FROM employee_service es WHERE es.service_id = $2::uuid)
            OR EXISTS (SELECT 1 FROM employee_service es WHERE es.service_id = $2::uuid AND es.employee_id = e.id)
          )
        ORDER BY e.sort_order, e.name`,
      [business.id, serviceId || null]
    );

    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=120');
    json(res, 200, {
      employees: rows.map((e) => ({ id: e.id, name: e.name, role: e.role_label })),
    });
  } catch (err) {
    serverError(res, err);
  }
}
