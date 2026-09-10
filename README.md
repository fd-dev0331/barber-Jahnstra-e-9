# Bregenz Barbershop — Website & Buchungssystem

Statische Website (HTML + Tailwind + Vanilla JS) mit eigenem Buchungs-Backend
(Vercel Functions + PostgreSQL) und Google-Calendar-Anbindung.

**Betrieb:** Bregenz Barbershop, Jahnstraße 9, 6900 Bregenz · Zeitzone `Europe/Vienna`

---

## Schnellstart

```bash
npm install
cp .env.example .env          # Werte eintragen, siehe unten
npm run db:migrate            # Schema anlegen
npm run db:seed               # Betrieb, Leistungen, Mitarbeiter, Arbeitszeiten
npm run dev                   # http://localhost:3210
```

Lokal läuft PostgreSQL in Docker auf Port **5433**; die Datenbank `barbershop`
wird einmalig angelegt:

```bash
docker exec it-simulator-db psql -U postgres -c "CREATE DATABASE barbershop"
```

## Tests

```bash
node scripts/test-booking.js      # 24 Prüfungen: Verfügbarkeit, Buchung, Validierung, ICS
node scripts/test-admin.js        # 33 Prüfungen: Setup, Anmeldung, Rechte, Dashboard-Rechte, Kündigung
node scripts/test-admin-i18n.js   # 62 Prüfungen: DE/RU/TR vollständig, Spracherkennung, Website bleibt deutsch
node scripts/test-race.js         # gleichzeitige Buchungen desselben Slots
node scripts/test-responsive.js   # feste Breiten, Viewport, Zoom
```

Der Dev-Server muss dafür laufen. `test-admin.js` meldet sich als Inhaber an;
weichen die Zugangsdaten ab, `ADMIN_TEST_EMAIL` und `ADMIN_TEST_PASSWORD`
setzen. Gibt es noch keinen Inhaber, legt der Test ihn an.

---

## Projektstruktur

```
public/           Ausgelieferte Website (Vercel outputDirectory)
  index.html      Start — eine Seite mit den Ankern #home, #ueber-uns,
                  #preise, #oeffnungszeiten und #kontakt; die Kopfzeile
                  verlinkt diese Abschnitte
  galerie.html    Galerie mit Lightbox (eigene Seite, nicht auf der Startseite)
  booking.html    Buchung (eigener JS-Bundle, keine Display-Schrift)
  admin/          Verwaltung: index (Anmeldung + Dashboard), bookings,
                  calendar, employees, services, business, google, settings
  assets/js/      site.js (gemeinsam) · home.js · gallery.js · booking.js
  assets/js/admin/ core.js (API, Formate) · shell.js (Kopfzeile, Navigation,
                  Sprachwahl) · ui.js (Dialoge, Zustände, Formularprüfung) ·
                  i18n.js + i18n/{de,ru,tr}.js · eine Datei je Admin-Seite
  assets/css/     site.css (Website) und admin.css (Verwaltung) — beide gebaut
api/              Vercel Functions
  services.js     GET  Leistungen
  employees.js    GET  aktive Mitarbeiter (optional je Leistung)
  availability.js GET  freie Zeiten für Datum + Leistung + Mitarbeiter
  bookings.js     POST Termin anlegen (mit Doppelbuchungsschutz)
  gallery.js      GET  Bilder aus dem Backend-Cache
  reviews.js      GET  echte Google-Rezensionen (leer, solange keine da sind)
  ics.js          GET  Kalenderdatei zur Buchungsreferenz
  admin/[...path].js  alle Admin-Endpunkte (eine Function, siehe unten)
  google/[...path].js OAuth 2.0: /api/google/start und /api/google/callback
lib/              db · http · time · availability · google · crypto · business · auth
  admin/          account · employees · services · bookings · settings · google · util
db/schema.sql     Schema
scripts/          migrate · seed · dev-api · Tests
src/css/input.css Tailwind-Quelle (Design-Tokens)
design-system/    Verbindliche Design-Vorgaben — vor UI-Änderungen lesen
```

`design-system/bregenz-barbershop/MASTER.md` ist die Quelle der Wahrheit für
Farben, Typografie und Komponenten. Jeder Farbwert dort hat einen berechneten
Kontrastwert. **Nicht ohne Nachrechnen ändern.**

---

## Umgebungsvariablen

| Variable | Pflicht | Zweck |
|---|---|---|
| `DATABASE_URL` | ja | PostgreSQL-Verbindung. Ersatzweise wird `POSTGRES_URL` akzeptiert, das die Supabase-Integration auf Vercel selbst anlegt. |
| `POSTGRES_URL_NON_POOLING` | für Supabase | Direkte Verbindung ohne Pooler. `db:migrate` und `db:seed` nutzen sie automatisch, falls vorhanden. |
| `TOKEN_ENCRYPTION_KEY` | für Google | 32 Byte base64, verschlüsselt die OAuth-Tokens |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | für Google | OAuth 2.0 |
| `INSTAGRAM_ACCESS_TOKEN` / `INSTAGRAM_USER_ID` | optional | Galerie-Sync |
| `GOOGLE_BUSINESS_*` | optional | echte Rezensionen |
| `SESSION_SECRET` | für /admin | Signiert den OAuth-`state`. Ohne den Wert lässt sich kein Google-Konto verbinden. |

Schlüssel erzeugen:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`.env` ist in `.gitignore` und darf **nie** committet werden.

---

## Verhalten ohne externe Dienste

Das System täuscht nirgends Funktionen vor, die nicht konfiguriert sind:

| Dienst | Nicht konfiguriert | Konfiguriert, aber gestört |
|---|---|---|
| Google Calendar | Buchungen laufen rein über die Datenbank | `503` + verständliche Meldung; **keine** Buchung wird angelegt |
| Instagram | Galerie zeigt manuell gepflegte Bilder aus derselben Tabelle | Cache wird weiter ausgeliefert |
| Google Rezensionen | Bewertungsblock bleibt **ausgeblendet** | Cache wird weiter ausgeliefert |

Der Bewertungsblock erzeugt unter keinen Umständen Beispielbewertungen oder ein
Platzhalter-Rating. Erfundene Rezensionen wären eine Irreführung und ein Verstoß
gegen Googles Richtlinien für strukturierte Daten.

---

## Verwaltung (`/admin`)

Beim ersten Aufruf prüft der Server, ob es schon einen aktiven `OWNER` gibt.
Wenn nicht, erscheint die **Ersteinrichtung**: Betriebsname, Name, E-Mail und
Passwort. Danach ist dieses Formular dauerhaft gesperrt — nicht nur in der
Anwendung, sondern über einen partiellen Unique-Index in der Datenbank
(`app_user_single_owner_idx`). Ein zweiter Benutzer kann sich nicht selbst zum
Inhaber machen.

| Seite | Rolle | Inhalt |
|---|---|---|
| `/admin` | alle | Termine heute, kommende Termine, Zahlen, Google-Status, Schnellaktionen |
| `/admin/bookings` | alle | Tabelle (ab 1280px) bzw. Karten, Filter, Suche, Details, Statuswechsel, Stornieren, manueller Termin mit freien Zeiten |
| `/admin/calendar` | alle | Tag, Woche, kommende Termine — in der Zeitzone des Betriebs |
| `/admin/employees` | ADMIN+ | Anlegen, bearbeiten, deaktivieren, reaktivieren, löschen (nur ohne Termine), Leistungen, Kalender, Arbeitszeiten, Pausen, Abwesenheiten |
| `/admin/services` | ADMIN+ | Leistungen mit Dauer, Preis, Status und zuständigen Mitarbeitern |
| `/admin/business` | ADMIN+ | Betriebsdaten, Zeitzone (Standard `Europe/Vienna`), Buchungsregeln, Öffnungszeiten (aus den Arbeitszeiten abgeleitet) |
| `/admin/google` | ADMIN+ | Konto verbinden/neu verbinden/trennen, verfügbare Kalender, Kalender je Mitarbeiter |
| `/admin/settings` | alle | Konto, Sprache, Passwort, Abmelden; Benutzerkonten nur für den Inhaber |

**Sprachen der Verwaltung.** Deutsch, Русский, Türkçe — umschaltbar in der
Kopfzeile, auf jeder Breite sichtbar. Die Wahl liegt in `localStorage`
(`admin_language`); ohne Wahl gilt die Browsersprache, sonst Deutsch. Alle Texte
stehen in `public/assets/js/admin/i18n/`; Fehlermeldungen der API werden über
ihren Code übersetzt. **Die öffentliche Website bleibt ausschließlich deutsch**
und lädt weder die Übersetzungen noch `admin.css`.

**Leistungen und Mitarbeiter.** `employee_service` ist eine Whitelist je
Leistung: ohne Einträge darf jeder aktive Mitarbeiter sie ausführen.
`assignments.js` rechnet Änderungen in den Dialogen in genau diese Einträge um.

**Rollen.** `OWNER` (alles inklusive Konten), `ADMIN` (alles außer Konten),
`EMPLOYEE` (nur eigene Termine, kann nur für sich selbst eintragen). Geprüft wird
das ausschließlich im Backend: `requireUser()` liest die Rolle aus der
Session-Zeile in der Datenbank. Die Rollenlogik im Browser blendet nur Knöpfe aus.

**Sessions.** Im Cookie steht ein Zufallstoken, in der Datenbank nur dessen
SHA-256-Hash. `HttpOnly`, `SameSite=Lax`, `Secure` in Produktion; 7 Tage gültig,
12 Stunden Leerlauf. Passwörter werden mit scrypt gehasht. Schreibende Anfragen
brauchen zusätzlich das CSRF-Token aus dem `bb_csrf`-Cookie im Header
`X-CSRF-Token`. Wird ein Konto gesperrt oder das Passwort geändert, sind alle
zugehörigen Sessions sofort ungültig.

**Warum eine einzige Function für alle Admin-Routen:** Vercel macht aus jeder
Datei unter `api/` eine eigene Serverless Function, und der Hobby-Plan lässt
zwölf zu. `api/admin/[...path].js` routet deshalb intern; die Fachlogik liegt in
`lib/admin/`.

---

## Google Calendar verbinden

1. Google Cloud Console → Projekt wählen → **Google Calendar API** aktivieren.
2. **OAuth consent screen** ausfüllen. Solange die App im Test-Modus steht, muss
   das Google-Konto des Betriebs dort als Testnutzer eingetragen sein.
3. **Credentials → OAuth client ID → Web application** anlegen.
4. Als *Authorized redirect URI* exakt den Wert aus `GOOGLE_REDIRECT_URI`
   eintragen — lokal `http://localhost:3210/api/google/callback`, in Produktion
   `https://<domain>/api/google/callback`.
5. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
   `TOKEN_ENCRYPTION_KEY` und `SESSION_SECRET` setzen, neu deployen.
6. In `/admin/google` auf **Google-Konto verbinden** klicken und danach jedem
   Mitarbeiter einen Kalender zuweisen.

Der Flow ist der offizielle: die Zustimmung passiert auf Googles Seite, der
Code-gegen-Token-Tausch im Backend, das Refresh-Token liegt AES-256-GCM-
verschlüsselt in `google_integration`. Client-Secret und Tokens erreichen den
Browser nie. Angefordert wird `.../auth/calendar` plus `openid`/`email` — Letzteres
nur, um die verbundene Adresse anzeigen zu können.

Architektur: **ein** Google-Konto des Betriebs, darin **mehrere Kalender**, je
Mitarbeiter einer (`employee.google_calendar_id`). Kein eigener OAuth-Durchlauf
je Mitarbeiter.

---

## Doppelbuchungsschutz

Drei Ebenen, weil eine nicht reicht:

1. **`SELECT … FOR UPDATE`** auf die Mitarbeiterzeile — serialisiert gleichzeitige
   Anfragen für dieselbe Person.
2. **Erneute Verfügbarkeitsprüfung** im Backend unmittelbar vor dem `INSERT`.
   Der Verfügbarkeit, die der Browser vor Sekunden gesehen hat, wird nicht vertraut.
3. **`EXCLUDE`-Constraint** in PostgreSQL (`booking_no_overlap`) — verhindert
   überlappende aktive Buchungen auf Datenbankebene, egal was die Anwendung tut.

Verifiziert mit `scripts/test-race.js`: bei gleichzeitigen Anfragen gewinnt genau
eine (`201`), die andere bekommt `409`.

---

## Deployment (Vercel)

1. Repository verbinden. `vercel.json` setzt Build, Output und Security-Header.
2. Environment Variables aus der Tabelle oben eintragen.
3. PostgreSQL bereitstellen (Neon, Supabase oder eigener Server) und
   `npm run db:migrate && npm run db:seed` gegen die Produktionsdatenbank laufen lassen.
   Bei der Supabase-Integration auf Vercel entsteht kein `DATABASE_URL`, sondern
   `POSTGRES_URL` (gepoolt) und `POSTGRES_URL_NON_POOLING` (direkt). Beides wird
   erkannt: die Anwendung nimmt die gepoolte Verbindung, Migration und Seed die
   direkte — `CREATE EXTENSION pgcrypto`/`btree_gist` in `db/schema.sql` läuft
   über den Transaction-Pooler nicht zuverlässig.
4. Domain verbinden. Danach in allen Seiten `https://bregenz-barbershop.at`
   durch die echte Domain ersetzen (`canonical`, Open Graph, `sitemap.xml`, JSON-LD).

---

## Offen / vom Kunden benötigt

- **Echte Fotos in voller Auflösung.** Hero, Über-uns-Bild und die neun
  Galeriekacheln stammen aus dem öffentlichen Instagram-Profil
  (`public/assets/img/`, Stand 08.09.2026) und sind als Zwischenlösung gedacht.
  Die Reel-Vorschaubilder liegen nur in 360 × 640 px vor — für den Hero sichtbar
  weich. Mit `INSTAGRAM_ACCESS_TOKEN` (Graph API) oder Originaldateien vom
  Kunden lassen sie sich 1:1 ersetzen; Dateinamen bleiben gleich. Einheitlicher
  Weißabgleich über den ganzen Satz, sonst wirkt das dunkle Raster
  zusammengewürfelt.
- **Telefonnummer in E.164 bestätigen.** `+436812039790` ist aus `0681 20397906`
  abgeleitet und **nicht verifiziert**.
- **Pausen und Urlaubszeiten.** Aktuell sind Mo–Fr 09–19 und Sa 09–18 ohne Pause
  hinterlegt; falls es eine Mittagspause gibt, muss sie in `working_hours`
  mit `is_break = true` eingetragen werden.
- **Google-Konto** für OAuth und den Kalender.
- **Instagram/Meta-App** für den Galerie-Sync (sonst manuelle Pflege).
- **Google Business Profile** für Rezensionen.
- Weitere Mitarbeiter, falls es mehr als „Abo" gibt.

### Noch nicht gebaut

- Instagram-Sync-Job (`scripts/sync-instagram.js`) — die Tabelle und der
  Endpunkt stehen, nur der Abholjob fehlt
- Rezensions-Sync-Job (dito)
- Verschieben eines bestehenden Termins auf eine andere Zeit (aktuell:
  stornieren und neu eintragen)
- Passwort-vergessen-Funktion (Reset läuft über den Inhaber unter
  `/admin/settings`)
- Impressum und Datenschutzerklärung (in Österreich Pflicht)
