# `/` (Home) — Page Overrides

> Rules here **override** `../MASTER.md`. Dark-first (v2).
> Section order comes from `info.md` §3; the reference design adds four blocks on top of it, each
> gated on real data below.

---

## Section order & treatment

| # | Section | Anchor | Surface | Notes |
|---|---|---|---|---|
| 1 | Hero | `#home` | photo + dark scrim | Full-bleed shop photo, `linear-gradient(rgba(14,13,12,.35), rgba(14,13,12,.92))`. Gold kicker, huge condensed uppercase H1, gold CTA + outline call button. |
| 2 | Über uns / Der Barbier | — | `--color-bg` | Asymmetric: photo left, text right. Owner story, Sprachen (DE/EN/AR/TR), barrierefrei. Optional stats row — **see gate below**. |
| 3 | Leistungen (preview) | `#services` | `--color-bg` | 4–6 `--color-surface` cards in a grid, gold price. Link „Alle Preise ansehen" → `/preise`. |
| 4 | Galerie / Unsere Arbeit | `#gallery` | `--color-bg` | 6–9 tile grid, 8px gap, hairline borders. Link → `/galerie`. |
| 5 | Öffnungszeiten | `#hours` | `--color-surface` band | Live „Jetzt geöffnet / Geschlossen" state. |
| 6 | Kontakt | `#contact` | `--color-bg` | Adresse, `tel:`, `mailto:`, Instagram. |
| 7 | Google Maps | (in `#contact`) | — | Consent-gated, see below. |
| 8 | Instagram | — | `--color-bg` | Profile link + 3 latest tiles from the gallery source. |
| 9 | CTA band | — | `--color-surface` | Full-width „Jetzt Termin buchen" → `/booking`. |
| — | Bewertungen | — | — | **Only if real reviews exist — see gate below.** |

The whole page is dark, so "dark band" no longer creates hierarchy the way it did in v1. Separation
now comes from **vertical rhythm** (`padding-block: 72px` → `120px`), the surface step
(`#0E0D0C` → `#1A1816`) and gold kickers. Do not add borders between every section.

## Hero

```
[gold kicker, .22em tracking]   JAHNSTRASSE 9 · BREGENZ
[H1, Barlow Condensed 700]      DEIN SCHNITT.
                                DEIN STIL.            ← second line in --color-accent
[body, --color-fg-body]         Präzise Haarschnitte, saubere Konturen und klassische
                                Bartpflege — Old-School Handwerk mitten in Bregenz.
[gold fill, dark label]         TERMIN BUCHEN →     [outline]  0681 20397906
```

- The two-tone headline (white line + gold line) is the reference's signature move. Use it **once**,
  in the hero, and nowhere else.
- H1 mobile 44px / desktop 84px, `line-height: 1.02`, `max-inline-size: 16ch`, `text-wrap: balance`,
  `hyphens: manual`.
- The phone button is a real `tel:` link, sized as a button. On desktop it stays visible — a walk-in
  barbershop gets more calls than forms.
- Text sits over the darkest part of the scrim. Never white text on an unscrimmed photo.
- **Hero owns the LCP:** `<picture>` AVIF/WebP, explicit `width`/`height`, `fetchpriority="high"`,
  preloaded in `<head>`, **not** lazy.
- Hero video (`info.md` §25) only if the client supplies a properly graded clip: poster is the LCP
  image, `preload="none"`, `muted playsinline`, no autoplay under `prefers-reduced-motion`. A still
  photograph is the better default here.

## ⚠️ Data gate — stats row and reviews

The reference shows `7+ Years`, `10k+ Fades`, `4.9 Google Rating`, and three review cards. **Those are
another business's template copy.** They are the easiest thing on this page to fake and the most
damaging: invented review text and a made-up Google rating are misrepresentation, and an Austrian
business page carries real legal exposure for it.

Rules:
- **Ship the section only with numbers the client confirms in writing.** Otherwise omit the block —
  the layout must look finished without it, so do not design a hero that depends on stats beneath it.
- Reviews must be **real Google reviews**, quoted accurately, with the reviewer's display name as it
  appears publicly and a link to the Google Business profile. Pull them through the Google Business
  Profile API or paste them verbatim — never paraphrase, never write sample ones "for now".
- If the client has few reviews, use **one** real quote rather than three padded ones, or replace the
  block with the „Was uns am Salon gefällt" content that already exists on their Treatwell page
  (Atmosphäre, Expertise, Produkte, Barrierefrei) — real, attributable, and already written.
- A placeholder like „4,9 ★" in a committed file has a way of reaching production. Leave the block
  out entirely until the data arrives.

Realistic candidates the client can actually verify: Jahre in Bregenz · gesprochene Sprachen (4) ·
Öffnungstage pro Woche (6) · Google-Bewertung (once confirmed).

## Öffnungszeiten — live state

Computed in **Europe/Vienna**, never from the device clock (`info.md` §23).
Today's row: `--color-fg`, Barlow 600, with a subtle `--color-surface-2` background. Other days
`--color-fg-muted`. Badge „Jetzt geöffnet" (`#4ADE80`) / „Geschlossen" (`--color-fg-muted`) —
**icon + text**, never color alone. Sunday shows „Geschlossen", not an empty cell.

```
Mo–Fr  09:00 – 19:00
Sa     09:00 – 18:00
So     Geschlossen
```

## Google Maps

Do **not** load the Maps iframe on first paint — it is the heaviest third-party asset on the site and
it sets cookies. Show a dark styled placeholder with a „Karte laden" button; the iframe mounts on
click. Performance *and* consent: the client's current Treatwell page already gates the map behind
cookie consent. Address text and an „In Google Maps öffnen" link are always present without loading
anything. If the loaded map is used, apply a dark Google Maps style so it does not flash a white
rectangle into the page.

## Navigation (`info.md` §4)

- Desktop: Home · Preise · Galerie · Kontakt · **[TERMIN BUCHEN]** (gold fill, dark label, always last).
  Nav labels uppercase, Barlow 500, `.08em` tracking, `--color-fg-body`; active/hover `--color-accent`.
- Header starts transparent over the hero and becomes `--color-bg` with a `--color-border` bottom
  hairline after 40px of scroll. **No backdrop-blur.** While transparent, the nav sits over the
  scrim's darkest band so contrast holds — verify it at 320px, where the hero photo crops tightest.
- Mobile: hamburger → full-screen `--color-bg` panel. `aria-expanded`, `aria-controls`, focus trapped,
  `Esc` closes, focus returns to the toggle. Toggle ≥ 48×48px, `aria-label="Menü öffnen"` /
  `"Menü schließen"`.
- Anchor links from other pages resolve as `/#services`. Anchor targets need `scroll-margin-top: 80px`
  so the fixed header does not cover the heading.

## Performance

Ship **zero** booking/admin JS here. Home JS target < 30 kB: the IntersectionObserver reveal, the
mobile menu, the hours state, and the map's click-to-load. Nothing else.

## SEO (`info.md` §26)

- `HairSalon` JSON-LD (more specific than `LocalBusiness`) with `address`, `geo`, `telephone`,
  `openingHoursSpecification`, `sameAs: [Instagram, Treatwell]`, `priceRange: "€"`.
- **Do not emit `aggregateRating` or `review` structured data unless the reviews are real.** Fabricated
  review markup is a Google spam-policy violation and can get the whole site's rich results dropped.
- Name, address and phone must match the Google Business Profile character for character.
- One H1 („Bregenz Barbershop – Friseur & Barbier in Bregenz"), H2 per section.
- The uppercase display treatment is **CSS `text-transform`**, so the underlying markup stays normally
  cased for screen readers and search engines. Never type headings in caps in the HTML — some screen
  readers spell all-caps words letter by letter.
- Unique title + meta description + canonical + Open Graph image (a real shop photo, 1200×630).
