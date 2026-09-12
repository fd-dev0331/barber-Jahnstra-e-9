/* Alle Admin-Endpunkte hinter einer einzigen Serverless Function.

   Warum eine Datei statt zwanzig: auf Vercel wird jede Datei unter /api zu einer
   eigenen Function, und der Hobby-Plan lässt zwölf zu. Die Fachlogik liegt in
   lib/admin/*, hier steht nur Routing plus die Zugriffsprüfung — und die läuft
   für jeden Pfad, bevor irgendein Handler drankommt (info.md §22).

   Routen:
     GET    /api/admin/setup                       öffentlich, sagt nur ob ein Inhaber fehlt
     POST   /api/admin/setup                       erster Inhaber (genau einmal möglich)
     POST   /api/admin/session                     Login
     GET    /api/admin/session                     aktueller Benutzer
     DELETE /api/admin/session                     Logout
     POST   /api/admin/session/telegram            Start der Mini App (signiertes initData)
     POST   /api/admin/session/telegram/link       einmalige Verknüpfung mit E-Mail + Passwort
     GET    /api/admin/telegram                    verknüpfte Telegram-Konten; DELETE /:id
     POST   /api/admin/password                    eigenes Passwort ändern
     GET    /api/admin/overview                    Dashboard
     GET    /api/admin/bookings                    Terminliste (Mitarbeiter: nur eigene)
     POST   /api/admin/bookings                    manueller Termin
     PATCH  /api/admin/bookings/:id                Statuswechsel
     DELETE /api/admin/bookings/:id                stornierten Termin löschen (ab ADMIN)
     GET    /api/admin/employees                   Mitarbeiter inkl. inaktive
     POST   /api/admin/employees
     PATCH  /api/admin/employees/:id
     DELETE /api/admin/employees/:id               nur ohne Terminhistorie
     POST   /api/admin/employees/:id/absences
     DELETE /api/admin/employees/:id/absences/:id
     GET    /api/admin/services                    POST / PATCH /:id / DELETE /:id
     GET    /api/admin/settings                    PATCH
     GET    /api/admin/users                       POST / PATCH /:id
     GET    /api/admin/google                      POST /api/admin/google/calendar, /disconnect
     POST   /api/admin/media                       Bild hochladen (Galerie, Mitarbeiterfoto)
     GET    /api/admin/gallery                     POST / PATCH /:id / DELETE /:id / POST /reorder
     GET    /api/admin/closures                    Feiertage + Schließtage; POST / POST /holiday / DELETE /:id */
import { fail, methodNotAllowed, serverError, readJson, rateLimit } from '../../lib/http.js';
import { requireUser, hasRole } from '../../lib/auth.js';
import { ensureSchema } from '../../lib/schema.js';
import { ValidationError } from '../../lib/admin/util.js';
import { GoogleUnavailableError } from '../../lib/google.js';
import * as account from '../../lib/admin/account.js';
import * as employees from '../../lib/admin/employees.js';
import * as services from '../../lib/admin/services.js';
import * as bookings from '../../lib/admin/bookings.js';
import * as settings from '../../lib/admin/settings.js';
import * as googleAdmin from '../../lib/admin/google.js';
import * as media from '../../lib/admin/media.js';
import * as gallery from '../../lib/admin/gallery.js';
import * as closures from '../../lib/admin/closures.js';
import * as telegram from '../../lib/admin/telegram.js';

/** Bilder kommen als Base64 im JSON — nur dieser Endpunkt darf so groß sein. */
const UPLOAD_LIMIT = 6_000_000;

/**
 * Pfadsegmente nach /api/admin, egal ob Vercel sie liefert oder der Dev-Server.
 *
 * Vercel ordnet dieser Datei in der Praxis nur EIN Segment zu: /api/admin/employees
 * erreicht die Function, /api/admin/employees/<id> endete mit 404 NOT_FOUND, bevor
 * hier irgendetwas lief — Bearbeiten, Deaktivieren und Löschen gingen deshalb nie.
 * vercel.json schreibt solche Pfade auf /api/admin/<resource>?__rest=<rest> um;
 * hier wird der Pfad aus URL, Runtime-Parameter und __rest wieder zusammengesetzt.
 */
function segments(req) {
  const url = new URL(req.url, 'http://localhost');
  let parts;
  if (/^\/api\/admin\/[^/]/.test(url.pathname) && !url.pathname.includes('[')) {
    parts = url.pathname.replace(/^\/api\/admin\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  } else {
    const fromRuntime = req.query?.path;
    parts = (Array.isArray(fromRuntime) ? fromRuntime : String(fromRuntime ?? '').split('/')).filter(Boolean);
  }
  const rest = url.searchParams.get('__rest') ?? req.query?.__rest;
  if (rest && parts.length <= 1) {
    parts = [...parts, ...String(rest).split('/').filter(Boolean).map(decodeURIComponent)];
  }
  return parts;
}

export default async function handler(req, res) {
  const path = segments(req);
  const [resource, id, sub, subId] = path;
  const params = new URL(req.url, 'http://localhost').searchParams;

  try {
    const body = ['POST', 'PATCH', 'PUT'].includes(req.method)
      ? await safeBody(req, res, resource === 'media' ? UPLOAD_LIMIT : undefined)
      : {};
    if (body === undefined) return; // Antwort wurde schon gesendet

    // Profilfelder, Galerie, Bilder und Telegram brauchen die Schema-Ergänzungen (lib/schema.js).
    if (['employees', 'gallery', 'media', 'telegram', 'settings', 'services'].includes(resource)) await ensureSchema();
    if (resource === 'session' && id === 'telegram') await ensureSchema();

    /* ---------------------------------------------------- ohne Anmeldung */

    if (resource === 'setup' && !id) {
      if (req.method === 'GET') return await account.getSetupState(req, res);
      if (req.method === 'POST') {
        if (!rateLimit(req, res, { limit: 5, windowMs: 600_000, key: 'setup' })) return;
        return await account.runSetup(req, res, body);
      }
      return methodNotAllowed(res, ['GET', 'POST']);
    }

    /* Telegram Mini App: die Anmeldung belegt `initData`, nicht ein Cookie.
       Geprüft wird die Signatur mit dem Bot-Token (lib/telegram.js) — hier läuft
       deshalb dieselbe Ratenbegrenzung wie beim Passwort-Login. */
    if (resource === 'session' && id === 'telegram') {
      if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
      if (!sub) {
        if (!rateLimit(req, res, { limit: 30, windowMs: 600_000, key: 'telegram' })) return;
        return await telegram.signIn(req, res, body);
      }
      if (sub === 'link') {
        if (!rateLimit(req, res, { limit: 10, windowMs: 600_000, key: 'login' })) return;
        return await telegram.link(req, res, body);
      }
      return fail(res, 404, 'not_found', 'Diesen Endpunkt gibt es nicht.');
    }

    if (resource === 'session' && !id) {
      if (req.method === 'POST') {
        // Passwortraten wird teuer gemacht, bevor überhaupt gehasht wird.
        if (!rateLimit(req, res, { limit: 10, windowMs: 600_000, key: 'login' })) return;
        return await account.login(req, res, body);
      }
      if (req.method === 'GET') return await account.me(req, res);
      if (req.method === 'DELETE') return await account.logout(req, res);
      return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);
    }

    /* ------------------------------------------------------ ab hier: Session.
       requireUser prüft Cookie, Kontostatus, CSRF-Token und Mindestrolle. Ohne
       gültige Session kommt kein Handler unten zum Zug. */

    if (resource === 'password' && req.method === 'POST') {
      const user = await requireUser(req, res, { minimum: 'EMPLOYEE' });
      if (!user) return;
      return await account.changePassword(req, res, body, user);
    }

    /* Die eigene Telegram-Verknüpfung geht jede Rolle etwas an; wer fremde
       sieht und löst, entscheidet lib/admin/telegram.js anhand der Rolle. */
    if (resource === 'telegram') {
      const user = await requireUser(req, res, { minimum: 'EMPLOYEE' });
      if (!user) return;
      if (req.method === 'GET' && !id) return await telegram.status(req, res, user);
      if (req.method === 'DELETE' && id) return await telegram.unlink(req, res, user, id);
      return methodNotAllowed(res, ['GET', 'DELETE']);
    }

    if (resource === 'overview') {
      const user = await requireUser(req, res);
      if (!user) return;
      if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
      return await bookings.overview(req, res, user);
    }

    if (resource === 'bookings') {
      const user = await requireUser(req, res);
      if (!user) return;
      if (req.method === 'GET' && !id) return await bookings.list(req, res, user, params);
      if (req.method === 'POST' && !id) return await bookings.create(req, res, body, user);
      if (req.method === 'PATCH' && id) return await bookings.update(req, res, body, user, id);
      /* Löschen ist der Leitung vorbehalten: ein Mitarbeiter darf seine Termine
         stornieren, aber keine Spuren beseitigen. */
      if (req.method === 'DELETE' && id) {
        if (!hasRole(user, 'ADMIN')) return fail(res, 403, 'forbidden', 'Dafür fehlt dir die Berechtigung.');
        return await bookings.remove(req, res, user, id);
      }
      return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE']);
    }

    /* Alles Weitere ist Sache der Leitung. Ein EMPLOYEE bekommt hier 403 —
       unabhängig davon, was sein Browser anzeigt. Nur die beiden Listen darf er
       lesen: ohne Leistungen und Kolleginnen kann er keinen Termin eintragen
       (info.md §18). Geändert wird damit nichts. */
    const readOnlyList = req.method === 'GET' && !id && ['employees', 'services'].includes(resource);
    const manager = await requireUser(req, res, { minimum: readOnlyList ? 'EMPLOYEE' : 'ADMIN' });
    if (!manager) return;

    if (resource === 'employees') {
      if (req.method === 'GET' && !id) return await employees.list(req, res, manager);
      if (req.method === 'POST' && !id) return await employees.create(req, res, body, manager);
      if (req.method === 'PATCH' && id && !sub) return await employees.update(req, res, body, manager, id);
      if (req.method === 'DELETE' && id && !sub) return await employees.remove(req, res, manager, id);
      if (req.method === 'POST' && sub === 'absences') return await employees.addAbsence(req, res, body, manager, id);
      if (req.method === 'DELETE' && sub === 'absences' && subId) {
        return await employees.removeAbsence(req, res, manager, id, subId);
      }
      return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE']);
    }

    if (resource === 'services') {
      if (req.method === 'GET' && !id) return await services.list(req, res, manager);
      if (req.method === 'POST' && !id) return await services.create(req, res, body, manager);
      if (req.method === 'PATCH' && id) return await services.update(req, res, body, manager, id);
      if (req.method === 'DELETE' && id) return await services.remove(req, res, manager, id);
      return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE']);
    }

    if (resource === 'media') {
      if (req.method === 'POST' && !id) return await media.upload(req, res, body, manager);
      return methodNotAllowed(res, ['POST']);
    }

    if (resource === 'gallery') {
      if (req.method === 'GET' && !id) return await gallery.list(req, res, manager);
      if (req.method === 'POST' && !id) return await gallery.create(req, res, body, manager);
      if (req.method === 'POST' && id === 'reorder') return await gallery.reorder(req, res, body, manager);
      if (req.method === 'PATCH' && id) return await gallery.update(req, res, body, manager, id);
      if (req.method === 'DELETE' && id) return await gallery.remove(req, res, manager, id);
      return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE']);
    }

    if (resource === 'closures') {
      if (req.method === 'GET' && !id) return await closures.list(req, res, manager);
      if (req.method === 'POST' && !id) return await closures.add(req, res, body, manager);
      if (req.method === 'POST' && id === 'holiday') return await closures.setHoliday(req, res, body, manager);
      if (req.method === 'DELETE' && id) return await closures.remove(req, res, manager, id);
      return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);
    }

    if (resource === 'settings') {
      if (req.method === 'GET') return await settings.getSettings(req, res);
      if (req.method === 'PATCH') return await settings.updateSettings(req, res, body, manager);
      return methodNotAllowed(res, ['GET', 'PATCH']);
    }

    if (resource === 'users') {
      // Benutzerkonten sind allein Sache des Inhabers.
      if (!hasRole(manager, 'OWNER')) return fail(res, 403, 'forbidden', 'Dafür fehlt dir die Berechtigung.');
      const owner = manager;
      if (req.method === 'GET' && !id) return await settings.listUsers(req, res, owner);
      if (req.method === 'POST' && !id) return await settings.createUser(req, res, body, owner);
      if (req.method === 'PATCH' && id) return await settings.updateUser(req, res, body, owner, id);
      return methodNotAllowed(res, ['GET', 'POST', 'PATCH']);
    }

    if (resource === 'google') {
      if (req.method === 'GET' && !id) return await googleAdmin.status(req, res, manager);
      if (req.method === 'POST' && id === 'calendar') return await googleAdmin.assignCalendar(req, res, body, manager);
      if (req.method === 'POST' && id === 'disconnect') return await googleAdmin.disconnect(req, res, manager);
      return methodNotAllowed(res, ['GET', 'POST']);
    }

    return fail(res, 404, 'not_found', 'Diesen Endpunkt gibt es nicht.');
  } catch (err) {
    if (err instanceof ValidationError) {
      return fail(res, 400, err.code, err.publicMessage);
    }
    if (err instanceof GoogleUnavailableError) {
      return fail(res, 503, 'calendar_unavailable',
        'Google Kalender ist gerade nicht erreichbar. Bitte versuch es gleich noch einmal.', err);
    }
    return serverError(res, err);
  }
}

async function safeBody(req, res, limit) {
  try {
    return await readJson(req, limit ? { limit } : undefined);
  } catch (err) {
    if (err?.message === 'payload_too_large') {
      fail(res, 413, 'image_too_large', 'Die Datei ist zu groß.');
    } else {
      fail(res, 400, 'invalid_body', 'Die Anfrage konnte nicht gelesen werden.');
    }
    return undefined;
  }
}
