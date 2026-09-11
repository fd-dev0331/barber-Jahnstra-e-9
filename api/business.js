/* GET /api/business — Stammdaten für die öffentliche Website.

   Eine Quelle für Kontakt, Öffnungszeiten und Preisliste: was in der Verwaltung
   gepflegt wird (Betrieb, Mitarbeiter-Arbeitszeiten, Leistungen), erscheint so
   ohne Umweg auf der Website. Das statische HTML bleibt als Rückfall für
   Crawler und für den Fall, dass diese Anfrage scheitert.

   Öffnungszeiten haben keine eigene Tabelle: offen ist, wann mindestens ein
   aktiver Mitarbeiter arbeitet — dieselbe Regel, nach der gebucht werden kann. */
import { query } from '../lib/db.js';
import { json, fail, methodNotAllowed, serverError } from '../lib/http.js';
import { ensureSchema } from '../lib/schema.js';
import { mediaUrl } from '../lib/admin/media.js';

const hhmm = (value) => String(value).slice(0, 5);

/** "DE · EN · AR", "Deutsch, Englisch" oder "DE EN AR" -> Liste. */
function splitLanguages(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  let parts = raw.split(/\s*[,;·/|]\s*/).filter(Boolean);
  if (parts.length === 1 && raw.split(/\s+/).every((token) => token.length <= 3)) parts = raw.split(/\s+/);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Überlappende oder aneinanderstoßende Schichten eines Tages zusammenfassen. */
function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0].localeCompare(b[0]));
  const merged = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = end > last[1] ? end : last[1];
    else merged.push([start, end]);
  }
  return merged;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    await ensureSchema();
    // Bewusst ohne den 60-s-Cache aus lib/business.js: eine Änderung in der
    // Verwaltung läuft in einer anderen Function-Instanz und leert ihn hier nicht.
    const { rows: businesses } = await query(
      `SELECT id, name, timezone, address, phone, email, instagram
         FROM business ORDER BY created_at LIMIT 1`
    );
    if (!businesses.length) return fail(res, 404, 'not_found', 'Kein Betrieb angelegt.');
    const business = businesses[0];

    const [{ rows: hours }, { rows: services }, { rows: assignments }, { rows: employees }] = await Promise.all([
      query(
        `SELECT wh.employee_id, wh.weekday, wh.start_time, wh.end_time
           FROM working_hours wh JOIN employee e ON e.id = wh.employee_id
          WHERE e.business_id = $1 AND e.status = 'ACTIVE' AND wh.is_break = false`,
        [business.id]
      ),
      query(
        `SELECT id, slug, name, description, category, duration_minutes, price_cents
           FROM service WHERE business_id = $1 AND status = 'ACTIVE'
          ORDER BY sort_order, name`,
        [business.id]
      ),
      query(
        `SELECT es.service_id, es.employee_id
           FROM employee_service es JOIN employee e ON e.id = es.employee_id
          WHERE e.business_id = $1`,
        [business.id]
      ),
      query(
        `SELECT id, name, status, role_label, show_on_website, headline, bio, languages,
                experience_years, photo_media_id
           FROM employee WHERE business_id = $1 ORDER BY sort_order, name`,
        [business.id]
      ),
    ]);

    const openingHours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      intervals: mergeIntervals(hours
        .filter((h) => h.weekday === weekday)
        .map((h) => [hhmm(h.start_time), hhmm(h.end_time)])),
    }));

    // employee_service ist eine Whitelist je Leistung (wie api/employees.js):
    // ohne Einträge führt jeder aktive Mitarbeiter die Leistung aus.
    const active = employees.filter((e) => e.status === 'ACTIVE');
    const performers = (serviceId) => {
      const listed = new Set(assignments.filter((a) => a.service_id === serviceId).map((a) => a.employee_id));
      return (listed.size ? active.filter((e) => listed.has(e.id)) : active).map((e) => e.name);
    };

    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
    json(res, 200, {
      business: {
        name: business.name,
        address: business.address,
        phone: business.phone,
        email: business.email,
        instagram: business.instagram,
        timezone: business.timezone,
      },
      openingHours,
      // Team-Slider: aktive Mitarbeiter, die auf der Website erscheinen sollen.
      team: active.filter((e) => e.show_on_website !== false).map((e) => ({
        id: e.id,
        name: e.name,
        role: e.role_label,
        headline: e.headline,
        bio: e.bio,
        languages: splitLanguages(e.languages),
        experienceYears: e.experience_years,
        photoUrl: mediaUrl(e.photo_media_id),
        workdays: [...new Set(hours.filter((h) => h.employee_id === e.id).map((h) => h.weekday))].sort((a, b) => a - b),
      })),
      services: services.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        description: s.description,
        category: s.category,
        durationMinutes: s.duration_minutes,
        priceCents: s.price_cents,
        employees: performers(s.id),
      })),
    });
  } catch (err) {
    serverError(res, err);
  }
}
