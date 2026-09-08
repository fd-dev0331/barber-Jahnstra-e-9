# `/admin` — Page Overrides

> Rules here **override** `../MASTER.md`.
> **Page type:** internal tool. Audience: the shop owner on a phone between clients, and on a laptop
> in the evening. Optimize for scanning and speed, not for brand expression.

---

## Dials

**Variance 2/10** (plain, predictable) · **Motion 1/10** (state transitions only) · **Density 8/10** (dense).

## Spacing override (density 8/10)

| Token | Value |
|---|---|
| `--space-xs` | `2px` |
| `--space-sm` | `4px` |
| `--space-md` | `8px` |
| `--space-lg` | `12px` |
| `--space-xl` | `16px` |
| `--space-2xl` | `24px` |
| `--space-3xl` | `32px` |

Table row height 44px (still a legal touch target), cell padding `8px 12px`.

## Typography

- **Barlow only** — no Barlow Condensed, no uppercase headings anywhere in `/admin`.
  Marketing type has no job in a data view; a dense table of caps is unreadable.
- Body 14px (this is the one place 14px is allowed; it is not customer-facing prose).
  Inputs stay at 16px to avoid iOS zoom. Numbers `tabular-nums`.

## Layout

- Surfaces: page `--color-bg`, panels/tables `--color-surface`, row hover `--color-surface-2`.
  Zebra striping is unnecessary on dark — a 1px `--color-border` row divider is enough and quieter.
- Left sidebar nav on ≥1024px; bottom-sheet drawer below that. Sections per `info.md` §19:
  Dashboard · Buchungen · Kalender · Mitarbeiter · Leistungen · Betrieb · Google · Einstellungen.
- Content max width: full, `padding-inline: 16px`.
- **Tables** (verified UX rule "Table Handling"): horizontal scroll container on desktop; below 768px
  each booking becomes a card (Datum/Zeit → Kunde → Leistung → Mitarbeiter → Status). Never a
  squeezed 6-column table on a phone.
- Sticky table header; the primary action column pinned right and `shrink-0`.

## Booking status badges (`info.md` §21)

Never color alone — icon + German label + color (WCAG 1.4.1):

| Status | Label | Fill / Text | Icon |
|---|---|---|---|
| `PENDING` | Offen | `rgba(251,191,36,.16)` / `#FBBF24` | clock |
| `CONFIRMED` | Bestätigt | `rgba(74,222,128,.16)` / `#4ADE80` | check-circle |
| `CANCELLED` | Storniert | `rgba(248,113,113,.16)` / `#F87171` | x-circle |
| `COMPLETED` | Erledigt | `rgba(168,162,158,.16)` / `#A8A29E` | check |
| `NO_SHOW` | Nicht erschienen | `rgba(251,113,133,.16)` / `#FB7185` | user-x |

Dark badges: a translucent tint of the status color over `--color-surface`, with the solid color as
text. Verified against the **composited** fill (not the raw surface): 7.44 / 7.25 / 5.03 / 5.35 /
5.16 — all AA. Do not port the light-mode pastel fills; `#78350F` on `#FEF3C7` becomes illegible
once the surface goes dark.

All five pairs are ≥ 4.5:1. Badge label uses `whitespace-nowrap min-w-0` — „Nicht erschienen" must not
wrap inside the pill (verified html-tailwind rule "Compact label layout", severity High).

## Dashboard (`info.md` §20)

Five stat tiles, no charts at launch: heutige Termine · nächste Termine · aktive Mitarbeiter ·
Leistungen · Google-Kalender-Status. A stat tile is a number (Barlow 600, 28px, `tabular-nums`) + a German label
(13px uppercase) + a link to the underlying list. A single-barber shop has too little data for a
chart to say anything — add one only if the owner asks.

**Google integration status is a first-class element**, not a footnote: green „Verbunden",
amber „Token läuft ab", red „Nicht verbunden – Buchungen sind blockiert" with a reconnect button.
If Google is down, this is why bookings fail, and the owner must see it on the first screen (`info.md` §32).

## Destructive & irreversible actions

- Mitarbeiter deaktivieren → confirm dialog stating the consequence: „Abo wird Kunden nicht mehr
  angezeigt und erhält keine neuen Buchungen. Bestehende Termine bleiben erhalten." (`info.md` §9)
- Deactivate is the default, delete is buried. Old bookings are never removed.
- Termin stornieren → confirm + a note that the Google Calendar event will also be cancelled.

## Permissions in the UI (`info.md` §10, §22)

Hiding a button is cosmetic only. An `EMPLOYEE` sees their own bookings and calendar; `OWNER` sees
everything plus Mitarbeiter, Leistungen, Betrieb and Google. **Every one of those is re-checked
server-side** — the frontend role check exists to reduce confusion, never to enforce access.

## States

Loading = skeleton rows (not spinners). Empty = „Für heute sind keine Termine eingetragen." + a
„Termin manuell anlegen" CTA. Error = plain German, retry button, no stack traces, no backend internals.

## Performance

`/admin` is behind auth and excluded from `sitemap.xml`; `<meta name="robots" content="noindex">`.
Its JS bundle never loads on any public route.
