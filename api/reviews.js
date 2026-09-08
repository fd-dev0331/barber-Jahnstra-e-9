/* GET /api/reviews — ausschließlich echte, gecachte Google-Rezensionen.
   Gibt es keine, kommt eine leere Liste zurück und der Block auf der Website
   bleibt ausgeblendet. Hier werden unter keinen Umständen Beispielbewertungen
   oder ein Platzhalter-Rating erzeugt (siehe pages/home.md, Datenschranke). */
import { query } from '../lib/db.js';
import { getBusiness } from '../lib/business.js';
import { json, methodNotAllowed, serverError } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const business = await getBusiness();

    const { rows } = await query(
      `SELECT author, rating, text, posted_at
         FROM review
        WHERE business_id = $1 AND status = 'ACTIVE'
        ORDER BY posted_at DESC NULLS LAST
        LIMIT 12`,
      [business.id]
    );

    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400');

    if (!rows.length) {
      return json(res, 200, { reviews: [], rating: null, total: 0 });
    }

    const { rows: agg } = await query(
      `SELECT round(avg(rating)::numeric, 1) AS rating, count(*)::int AS total
         FROM review WHERE business_id = $1 AND status = 'ACTIVE'`,
      [business.id]
    );

    json(res, 200, {
      reviews: rows.map((r) => ({
        author: r.author,
        rating: Number(r.rating),
        text: r.text,
        postedAt: r.posted_at,
      })),
      rating: agg[0]?.rating ?? null,
      total: agg[0]?.total ?? rows.length,
      profileUrl: process.env.GOOGLE_BUSINESS_PROFILE_URL || null,
    });
  } catch (err) {
    serverError(res, err);
  }
}
