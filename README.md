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
node scripts/test-booking.js      # 22 Prüfungen: Verfügbarkeit, Buchung, Validierung
node scripts/test-admin.js        # 69 Prüfungen: Setup, Anmeldung, Rechte, Mitarbeiter, Leistungen,
                                  #   Galerie, Bilder, Feiertage und Schließtage
node scripts/test-admin-i18n.js   # 70 Prüfungen: DE/RU/TR vollständig, Spracherkennung, Website bleibt deutsch
node scripts/test-website.js      # 31 Prüfungen: keine Beispieldaten im HTML, Bilder und Angebote
                                  #   aus der Verwaltung
node scripts/test-telegram.js     # 29 Prüfungen: Mini App — Signatur, Verknüpfung, Bearer-Sitzung
                                  #   braucht TELEGRAM_BOT_TOKEN, derselbe Wert wie im Dev-Server
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
                  telegram.js (Mini App) · i18n.js + i18n/{de,ru,tr}.js ·
                  eine Datei je Admin-Seite
  assets/css/     site.css (Website) und admin.css (Verwaltung) — beide gebaut
api/              Vercel Functions
  services.js     GET  Leistungen
  employees.js    GET  aktive Mitarbeiter (optional je Leistung)
  availability.js GET  freie Zeiten für Datum + Leistung + Mitarbeiter
  bookings.js     POST Termin anlegen (mit Doppelbuchungsschutz)
  gallery.js      GET  Bilder aus dem Backend-Cache
  reviews.js      GET  echte Google-Rezensionen (leer, solange keine da sind)
  business.js     GET  Kontakt, Öffnungszeiten, Preisliste, Team für die Website
  media.js        GET  Bilder aus der Verwaltung: ?id=<uuid> (dauerhaft cachebar)
                  oder ?slot=hero (Titelbild, für og:image)
  telegram.js     POST Webhook des Bots (nur mit gültigem Secret)
  admin/[...path].js  alle Admin-Endpunkte (eine Function, siehe unten)
  google/[...path].js OAuth 2.0: /api/google/start und /api/google/callback
lib/              db · http · time · availability · google · crypto · business · auth
                  telegram (initData prüfen, Bot-API) · holidays · schema · media
  admin/          account · employees · services · bookings · settings · google ·
                  telegram · gallery · closures · media · util
db/schema.sql     Schema
scripts/          migrate · seed · dev-api · telegram-setup · Tests
src/css/input.css Tailwind-Quelle (Design-Tokens)
public/assets/img/ leer — alle Bilder der Website liegen in der Datenbank
                  (Tabelle media), gepflegt in der Verwaltung
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
| `TELEGRAM_BOT_TOKEN` | für Telegram | Token des Bots vom @BotFather. Fehlt er, ist die Mini App aus; `/admin` bleibt im Browser unverändert. |
| `TELEGRAM_WEBHOOK_SECRET` | für Telegram | Frei gewählt. Ohne passenden Wert im Header beantwortet `/api/telegram` nichts. |
| `PUBLIC_BASE_URL` | für Telegram | https-Adresse der Website. Telegram öffnet Mini Apps nur über https. |

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
| Telegram | Mini App und Bot sind aus (`503`), die Verwaltung im Browser bleibt unberührt | Anmeldung schlägt mit verständlicher Meldung fehl |

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
| `/admin/bookings` | alle | Tabelle (ab 1280px) bzw. Karten, Filter, Suche, Details, Statuswechsel, Stornieren, manueller Termin mit freien Zeiten; **stornierte Termine löschen** (ADMIN+) |
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

### Was sich löschen lässt — und was nicht

Ein Eintrag verschwindet nur, wenn dadurch keine Geschichte verloren geht:

| | Löschen erlaubt | sonst |
|---|---|---|
| Mitarbeiter | nur ohne einen einzigen Termin in der Historie | deaktivieren |
| Leistung | nur ohne einen einzigen Termin in der Historie | deaktivieren |
| Termin | nur wenn storniert, und nur ab `ADMIN` | stornieren |

Ein wahrgenommener, offener oder als „nicht erschienen" vermerkter Termin bleibt
also bestehen; wer ihn loswerden will, storniert ihn zuerst und trifft damit eine
sichtbare Entscheidung. Danach ist das Löschen endgültig — kein Papierkorb. Die
Oberfläche zeigt den Knopf nur dort, wo er erlaubt ist, und das Backend prüft es
noch einmal (`409 has_bookings` bzw. `409 not_cancelled`, `403` für Mitarbeiter).

Steht beim Stornieren ein Eintrag im Google Kalender, wird er dort gelöscht. War
Google in dem Moment nicht erreichbar, versucht es das Löschen des Termins noch
einmal und sagt es, falls es wieder nicht klappt.

## Was die Website anzeigt

Alles Inhaltliche der Website kommt aus der Verwaltung, über `GET /api/business`
und `GET /api/gallery`:

| Auf der Seite | Quelle in der Verwaltung |
|---|---|
| Titelbild der Startseite | Betrieb → Bild der Startseite |
| Team-Slider „Über uns" | Mitarbeiter (Profil, Foto, Sprachen, Arbeitstage) |
| Preisliste — zwei Blöcke: Angebote, dann alles Übrige | Leistungen (Häkchen „Angebot“) |
| Öffnungszeiten, „Jetzt geöffnet" | Arbeitszeiten der aktiven Mitarbeiter + Schließtage |
| Adresse, Telefon, E-Mail, Instagram | Betrieb |
| Galerie | Galerie |

Im HTML steht davon **nichts** — kein Beispielpreis, keine feste Uhrzeit, keine
erfundene Person, kein Bild aus `public/assets/img/`. Solche Rückfallwerte gab es
früher; beim Laden waren sie kurz zu sehen, und wer etwas in der Verwaltung
geändert hatte, sah einen Moment lang den alten Stand.

Bis die Antwort da ist, stehen an diesen Stellen graue Ladeflächen. Kommt keine
Antwort, erscheint ein Satz, dass die Angaben gerade nicht geladen werden konnten.
Ist in der Verwaltung nichts hinterlegt, entfällt der Abschnitt: ohne Mitarbeiter
mit Profil kein Team-Slider, ohne Titelbild ein dunkler Seitenkopf, ohne Bilder
eine leere Galerie mit Hinweis.

Die Preisliste hat genau zwei Blöcke: erst die Leistungen mit dem Häkchen
„Angebot“, danach alle anderen. Eine Gliederung nach Art der Leistung gibt es
nicht mehr — sie zerlegte die Liste in lauter kurze Abschnitte, ohne beim
Aussuchen zu helfen. Das frühere Feld „Kategorie“ ist aus der Verwaltung
verschwunden; die Spalte bleibt in der Datenbank, wird aber nirgends gelesen.

Das gilt auch für das Vorschaubild beim Teilen (`og:image`): es zeigt auf
`/api/media?slot=hero`, also auf dasselbe Titelbild. Diese Adresse bleibt gleich,
wenn das Bild gewechselt wird, und wird deshalb nur kurz zwischengespeichert —
`/api/media?id=…` dagegen dauerhaft, weil eine ID immer zu demselben Bild gehört.

Was das kostet: Ohne JavaScript oder bei nicht erreichbarem Server bleiben diese
Stellen leer. Das ist bewusst so — eine veraltete Angabe wäre schlimmer als keine.

---

## Telegram Mini App

Dieselbe Verwaltung, geöffnet im Telegram-Bot. Kein zweites Frontend: es sind
die Seiten unter `public/admin/`, nur in Telegrams Rahmen.

**Einrichten (einmalig)**

1. Beim [@BotFather](https://t.me/BotFather) einen Bot anlegen, Token kopieren.
2. `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` und `PUBLIC_BASE_URL` setzen —
   lokal in `.env`, auf Vercel unter Project Settings → Environment Variables.
3. `node scripts/telegram-setup.js` ausführen. Das Skript setzt den Menüknopf
   des Bots auf `<BASE>/admin`, die Befehle `/start` und `/help` (de, ru, tr)
   und den Webhook auf `<BASE>/api/telegram`.
   `node scripts/telegram-setup.js --status` zeigt nur den Zustand.
4. Im Bot `/start` senden und die Verwaltung öffnen.

**Anmeldung**

Telegram schickt beim Start ein signiertes `initData` mit. Der Server rechnet
die Signatur mit dem Bot-Token nach (`lib/telegram.js`) und prüft `auth_date` —
älter als 24 Stunden gilt nicht mehr.

Ein Telegram-Konto allein ist **kein** Zugang. Beim ersten Öffnen fragt die Mini
App einmalig nach E-Mail und Passwort — denselben wie im Browser — und verknüpft
danach beides (`telegram_account`). Jeder weitere Start meldet sich lautlos an.
Gesperrte Konten kommen auch mit Verknüpfung nicht herein.

Die Verknüpfungen stehen unter **Einstellungen → Telegram**: der Inhaber sieht
alle des Betriebs, alle anderen nur ihre eigene, und jede lässt sich dort lösen.

**Sitzung**

Auf Telegram Web läuft die Mini App in einem iframe; ein `SameSite=Lax`-Cookie
käme dort nicht an. Diese Sitzungen tragen ihr Token deshalb im
`Authorization: Bearer`-Header. Es ist dasselbe Token aus `app_session`, mit
demselben Ablauf — nur ein anderer Transportweg. Einen Header kann keine fremde
Seite ungefragt mitschicken, CSRF-Schutz braucht dieser Weg deshalb nicht; für
Cookie-Sitzungen bleibt die Prüfung unverändert bestehen.

Das Token liegt im `sessionStorage` der Mini App: beim Schließen ist es weg,
beim nächsten Start entsteht aus `initData` ein neues.

**Was in Telegram anders aussieht**

- Sprache: Ohne eigene Wahl gilt die Sprache des Telegram-Kontos (de/ru/tr).
  Eine Wahl in der Verwaltung ist immer stärker.
- Zurück-Knopf und Kopfzeile stellt Telegram; die Höhe kommt aus
  `viewportStableHeight`.
- „Abmelden" fehlt: der nächste Start würde sich sofort wieder anmelden. Wer
  wirklich hinaus will, löst die Verknüpfung.

**Telegram Web**

Auf web.telegram.org läuft die Mini App in einem iframe. `vercel.json` erlaubt
deshalb für `/admin` ausdrücklich `frame-ancestors 'self' https://web.telegram.org`;
für die Website gilt weiterhin `X-Frame-Options: SAMEORIGIN`. In den
Telegram-Apps für iOS, Android und Desktop ist kein iframe im Spiel — dort ist
das ohne Belang.

**Ohne Bot-Token** ist die ganze Anbindung aus: `/api/telegram` und die
Mini-App-Anmeldung antworten mit `503`, die Verwaltung im Browser bleibt
unverändert.

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

- **Bilder in der Verwaltung hinterlegen.** Im Repository liegt kein einziges
  Foto mehr: Titelbild (Betrieb → Bild der Startseite), Mitarbeiterfotos
  (Mitarbeiter → Profil) und Galerie kommen aus der Verwaltung. Solange dort
  nichts liegt, bleibt der Kopf dunkel und die Galerie zeigt „Noch keine
  Bilder" — es wird nichts erfunden. Querformat für das Titelbild, gleicher
  Weißabgleich über den ganzen Satz.
- **Telefonnummer in E.164 bestätigen.** `+436812039790` ist aus `0681 20397906`
  abgeleitet und **nicht verifiziert**.
- **Pausen und Urlaubszeiten.** Aktuell sind Mo–Fr 09–19 und Sa 09–18 ohne Pause
  hinterlegt; falls es eine Mittagspause gibt, muss sie in `working_hours`
  mit `is_break = true` eingetragen werden.
- **Google-Konto** für OAuth und den Kalender.
- **Telegram-Bot** vom @BotFather, falls die Verwaltung in Telegram laufen soll
  (Token + Webhook-Secret, danach `node scripts/telegram-setup.js`).
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
