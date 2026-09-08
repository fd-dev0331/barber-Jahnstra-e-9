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
node scripts/test-race.js         # gleichzeitige Buchungen desselben Slots
node scripts/test-responsive.js   # feste Breiten, Viewport, Zoom
```

Der Dev-Server muss dafür laufen.

---

## Projektstruktur

```
public/           Ausgelieferte Website (Vercel outputDirectory)
  index.html      Start — eine Seite mit den Ankern #home, #ueber-uns,
                  #preise, #oeffnungszeiten und #kontakt; die Kopfzeile
                  verlinkt diese Abschnitte
  galerie.html    Galerie mit Lightbox (eigene Seite, nicht auf der Startseite)
  booking.html    Buchung (eigener JS-Bundle, keine Display-Schrift)
  assets/js/      site.js (gemeinsam) · home.js · gallery.js · booking.js
api/              Vercel Functions
  services.js     GET  Leistungen
  employees.js    GET  aktive Mitarbeiter (optional je Leistung)
  availability.js GET  freie Zeiten für Datum + Leistung + Mitarbeiter
  bookings.js     POST Termin anlegen (mit Doppelbuchungsschutz)
  gallery.js      GET  Bilder aus dem Backend-Cache
  reviews.js      GET  echte Google-Rezensionen (leer, solange keine da sind)
  ics.js          GET  Kalenderdatei zur Buchungsreferenz
lib/              db · http · time · availability · google · crypto · business
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
| `DATABASE_URL` | ja | PostgreSQL-Verbindung |
| `TOKEN_ENCRYPTION_KEY` | für Google | 32 Byte base64, verschlüsselt die OAuth-Tokens |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | für Google | OAuth 2.0 |
| `INSTAGRAM_ACCESS_TOKEN` / `INSTAGRAM_USER_ID` | optional | Galerie-Sync |
| `GOOGLE_BUSINESS_*` | optional | echte Rezensionen |
| `SESSION_SECRET` | für /admin | Admin-Sessions |

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

- `/admin` (Dashboard, Buchungen, Mitarbeiter, Leistungen, Google-Integration)
- Google-OAuth-Routen (`/api/google/authorize`, `/api/google/callback`)
- Instagram-Sync-Job (`scripts/sync-instagram.js`)
- Rezensions-Sync-Job
- Manuelle Buchung und Stornierung aus dem Admin heraus
- Impressum und Datenschutzerklärung (in Österreich Pflicht)
