# `/galerie` — Page Overrides

> Rules here **override** `../MASTER.md`.
> **Page type:** media grid. This is the heaviest page on the site — the budget rules are strict.

---

## Layout

- Tiles sit directly on `--color-bg` with a `--color-border` hairline and an 8px gap, as in the
  reference's portfolio block — no card padding, no rounded-corner frames larger than `--radius-sm`.
  The photographs are the design; chrome around them dilutes it.
- Full-bleed masonry-ish CSS grid: `grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))`,
  gap 8px mobile / 16px desktop. 1 column at 320px, 2 at 375px, 3 at 768px, 4 at 1280px.
- **Every tile has a reserved aspect ratio** (`aspect-square` for posts, `aspect-[9/16]` for reels).
  Verified html-tailwind rule "Reserve image space", severity High — CLS < 0.1 depends on it.

## Media rules (`info.md` §25)

- Images: AVIF → WebP → JPEG `<picture>`, `srcset` at 320/640/960/1280, explicit `width`/`height`,
  `loading="lazy" decoding="async"` on all but the first row.
- Video tiles: `poster` required, `preload="none"`, `muted playsinline`, click-to-play.
  **Never autoplay** — and under `prefers-reduced-motion: reduce` show the poster only.
- Hard budget: first viewport ≤ 400 kB of media. Everything else lazy.

## Lightbox

- Native `<dialog>` — no lightbox library (`info.md` §2: no heavy libraries).
- Requirements: focus trapped inside, focus returns to the triggering tile on close,
  `Esc` closes, `←`/`→` navigate, `aria-label="Bild 3 von 24"`, close button ≥ 48×48px,
  swipe on touch. Overlay `rgba(12,10,9,0.9)`, no backdrop-filter.
- Body scroll locked while open, without a layout shift from the scrollbar.

## Instagram integration (`info.md` §33, §34)

Design must work in **all three** states, because the API tier is not yet decided:

| State | UI |
|---|---|
| API connected | Grid from backend cache. A small "Instagram" attribution chip per tile linking to the post. |
| Embed fallback | Official embed block, lazy-mounted on scroll — never in the initial HTML. |
| Manual fallback | Same grid, images from `/public/gallery`, owner updates via `/admin`. **Visually identical** to the API state. |

The tile component takes `{src, alt, type, permalink?}` — it must not know which source produced it,
so switching from manual to API later requires no frontend change (`info.md` §120).

- **Never** call the Instagram API from the browser with a secret. Backend + cache only.
- Empty state: „Galerie wird gerade aktualisiert." + CTA to the Instagram profile. Never a blank grid.
- Error state: fall back to cached/manual images silently; do not show an API error to a customer.

## Accessibility

- Real `alt` per image in German („Herren-Haarschnitt mit Fade, seitliche Ansicht"). Never `alt="image"`,
  never the raw Instagram caption dumped in.
- Grid tiles are `<button>` or `<a>`, keyboard-reachable in DOM order, visible focus ring.
- Reels: provide a text description; no audio autoplay.

## CTA

One gold "Termin buchen" band after the first ~12 tiles, and one at the end (`info.md` §5).
Gold fill, dark label.

## White balance

The single biggest risk on this page. Barbershop interiors are tungsten-lit; phone photos taken on
different days will swing warm-to-cool and the dark grid will look assembled from stock. Normalize
white balance across the whole set before upload, and reject any image that does not match.
