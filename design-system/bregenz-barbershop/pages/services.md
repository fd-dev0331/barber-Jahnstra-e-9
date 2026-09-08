# `/preise` (Services / Price) — Page Overrides

> Rules here **override** `../MASTER.md`.
> **Page type:** price list / conversion catalogue. German URL slug `/preise` — it is the term
> the client's own site uses ("Preisliste") and what Austrian customers search for.

---

## Layout

- Max width `860px` — a price list is a reading column, not a 12-column grid.
- Grouped by the client's own categories: **Angebote** → **Herren – Haarschnitte & Stylings**.
- One service = one row. Two columns on desktop (`name + description + duration` | `price + CTA`),
  stacked on mobile with the price directly under the name.
- Category heading: Barlow Condensed 700, UPPERCASE, 30/46px, gold kicker above and a 48×2px gold rule beneath.

## Service row anatomy (`info.md` §3)

Every row shows: **Name · Beschreibung · Dauer · Preis · verfügbare Mitarbeiter · [Termin buchen]**.

```
Herren – Haarschnitt                              25,00 €
Klassischer Schnitt inkl. Konturen.
30 Min. · Abo                                 [Termin buchen]
```

- Duration and barber names sit in a `label`-sized Barlow 500 row, `--color-fg-muted`.
- Price: Barlow 600, `--color-accent`, `font-variant-numeric: tabular-nums`, Austrian format `25,00 €`.
- CTA per row deep-links: `/booking?service=<slug>` — preselects step 1.

## Verified client price list (source: Treatwell, fetched 2026-09-08)

| Kategorie | Leistung | Dauer | Preis |
|---|---|---|---|
| Angebote | Haarschnitt + Augenbrauen mit Messer | 40 Min. | 25,00 € |
| Angebote | Haarschnitt + Waschen | 40 Min. | 27,00 € |
| Angebote | Gruppenrabatt ab 5 Personen | 30 Min. | 20,00 € |
| Herren | Herren – Haarschnitt | 30 Min. | 25,00 € |
| Herren | Kinder – Haarschnitt bis 10 Jahre | 15 Min. | 18,00 € |
| Herren | Herren – Haare waschen | 10 Min. | 5,00 € |
| Herren | Herren – Bart | 15 Min. | 15,00 € |
| Herren | Herren – Augenbrauen mit Messer | 10 Min. | 5,00 € |
| Herren | Herren – Augenbrauen mit Faden | 10 Min. | 5,00 € |

> These are **seed data for the database**, not hardcoded frontend content. Prices change; the page
> renders from the `Service` table (`info.md` §17). Confirm with the client before launch.
> Note the 10–15 min services — the slot generator must handle short durations, not assume 30 min.

## Typography / German

- Descriptions max ~90 characters; `line-clamp` is forbidden here — a truncated price description
  costs a booking. Write short copy instead.
- `hyphens: auto` on descriptions ("Augenbrauen", "Gruppenrabatt" overflow at 320px otherwise).

## Color

- Every row is a `--color-surface` card with a `--color-border` hairline, matching the reference's
  service grid. No alternating stripes, no gold row tint — gold is the price and the CTA only.
- On ≥768px the rows may form a 2- or 3-column card grid (as in the reference) instead of a list;
  keep one service per card and never let the price wrap away from its service name.
- "Angebote" category may carry a single gold `Aktion` chip; no more than one accent element per row.

## Motion & Performance

- Service names stay sentence/title case as the client writes them — do **not** uppercase
  „Kinder – Haarschnitt bis 10 Jahre"; it is past the ~40-character uppercase limit.
- Static HTML. No JS required to read prices — this page must work with JS disabled.
- No images in rows. Optional single header photo, `fetchpriority="high"`, explicit dimensions.

## SEO (`info.md` §26)

- `Service` / `Offer` JSON-LD nested in the `HairSalon` LocalBusiness entity, with
  `priceCurrency: "EUR"` and the duration as ISO 8601 (`PT30M`).
- H1: „Preise & Leistungen", H2 per category, H3 per service name.
- This page is the strongest organic entry point ("barber bregenz preise") — unique title + meta description.
