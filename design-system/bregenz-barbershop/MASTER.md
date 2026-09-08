# Design System Master File — Bregenz Barbershop

> **LOGIC:** When building a specific page, first check `design-system/bregenz-barbershop/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Bregenz Barbershop (Jahnstraße 9, 6900 Bregenz, AT)
**Revision:** v2 — **dark-first**, 2026-09-08. Replaces the v1 light "premium black + gold on white" system
at the client's direction (reference: a dark cinematic barbershop landing page).
**Language:** German (`<html lang="de">`) · **Timezone:** Europe/Vienna
**Design Dials:** Variance 5/10 (bolder, editorial) · Motion 3/10 (Subtle) · Density 4/10 (Standard)

> **This site is dark-only.** There is no light theme. `color-scheme: dark` is declared, the palette
> is defined once on `:root`, and no `prefers-color-scheme` block exists. A half-implemented light
> mode is worse than none — if the client later wants one, it is a separate piece of work.

### Verified business facts (source: client's Treatwell site, fetched 2026-09-08)

| Field | Value |
|---|---|
| Name | Bregenz Barbershop |
| Address | Jahnstraße 9, 6900 Bregenz |
| Phone | `tel:+436812039790` → display `0681 20397906` |
| Email | `abdulrahmanhamrawe1994@gmail.com` |
| Instagram | https://www.instagram.com/bregenz_barbershop/ |
| Owner / sole barber | Abdulrahman ("Abo") — Deutsch, English, العربية, Türkçe |
| Hours | Mo–Fr 09:00–19:00 · Sa 09:00–18:00 · So geschlossen |
| Positioning | Old-School + orientalische Barbier-Tradition, barrierefrei |

> ⚠️ `tel:` in E.164 form is **unverified** — confirm with the client.
> ⚠️ The reference design shows a stats row (`7+ years`, `10k+ fades`, `4.9 rating`) and review cards.
> Those numbers are **template placeholders from another business.** See `pages/home.md` — nothing
> in that shape ships until the client supplies real figures and real Google reviews.

---

## Global Rules

### Color Palette — dark, warm near-black + gold

Style base: **Dark Mode (OLED)** (verified — `perf: cost:low | drivers:none`, `framework: tailwind`).
The stock `#121212` neutral is warmed to a stone hue so it sits under the brand's gold without going
blue. **Every ratio below was computed, not estimated.**

| Role | Hex | CSS Variable | Contrast (verified) |
|------|-----|--------------|---------------------|
| Background (page) | `#0E0D0C` | `--color-bg` | warm near-black |
| Surface (card) | `#1A1816` | `--color-surface` | elevation 1 |
| Surface raised | `#22201D` | `--color-surface-2` | elevation 2, hover |
| Foreground (headings) | `#FFFFFF` | `--color-fg` | on bg = **19.42:1** AAA |
| Body text | `#D6D3D1` | `--color-fg-body` | on bg = **13.03:1** · on surface = **11.89:1** AAA |
| Muted text | `#A8A29E` | `--color-fg-muted` | on bg = **7.70:1** · on surface = **7.02:1** AAA |
| **Accent / gold** | `#D4AF37` | `--color-accent` | on bg = **9.23:1** · on surface = **8.42:1** AAA |
| **On accent** | `#0E0D0C` | `--color-on-accent` | on gold = **9.23:1** AAA |
| Accent hover | `#E0B44C` | `--color-accent-hover` | on bg = **9.99:1** |
| Border (decorative) | `#2A2724` | `--color-border` | 1.31:1 — card edges, dividers **only** |
| Border strong | `#6B6560` | `--color-border-strong` | on bg = **3.38:1** · on surface = **3.08:1** — form controls |
| Ring (focus) | `#D4AF37` | `--color-ring` | 9.23:1 against both surfaces |
| Destructive | `#F87171` | `--color-destructive` | on surface = **6.40:1** AAA |

**Three hard rules, all of which the naive version of this palette gets wrong:**

1. **The gold button takes DARK text, never white.** White on `#D4AF37` is **2.10:1** — a hard WCAG
   failure and the single most likely mistake when porting a light-mode CTA to dark. Gold fill +
   `#0E0D0C` label = 9.23:1.
2. **The v1 accent `#A16207` is retired.** On `#0E0D0C` it is **3.94:1** — it fails as text and as a
   button fill. Do not carry it over from the old system; every occurrence becomes `#D4AF37`.
3. **`--color-border` (`#2A2724`) is decorative only.** Any input, select, checkbox or slot edge uses
   `--color-border-strong` (3:1, WCAG 1.4.11). A 1.3:1 hairline around a form field is invisible.

Additional dark-mode discipline:
- **No pure `#000000` page background.** Pure black against white text causes halation; the warm
  near-black also lets card elevation read.
- **Elevation is surface lightness, not shadow.** Shadows are nearly invisible on dark — a card
  separates by going `#1A1816` against `#0E0D0C` plus a `#2A2724` hairline. Keep shadows only for
  overlays (modal, dropdown, lightbox).
- Gold is the CTA and the kicker color. It never becomes a section background, never fills a large
  area, and never carries body copy.

### Typography

Pairing: **Sports/Fitness — Barlow Condensed + Barlow** (verified — "condensed for impact headlines,
regular Barlow for body"). Condensed uppercase display matches the reference's heavy headline
treatment, and the barbershop's masculine, athletic register.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600&display=swap">
```

```js
// tailwind.config
fontFamily: { display: ['Barlow Condensed','Oswald','sans-serif'], sans: ['Barlow','system-ui','sans-serif'] }
```

**Scale** — base 16px, line-height 1.5 body / 1.05 display:

| Token | Mobile | Desktop | Spec |
|---|---|---|---|
| hero | 44px | 84px | Barlow Condensed 700, **UPPERCASE**, `tracking: .01em`, `line-height: 1.02` |
| h2 | 30px | 46px | Barlow Condensed 700, UPPERCASE, `tracking: .02em` |
| h3 | 19px | 22px | Barlow 600, sentence case (service names keep their real casing) |
| body | 16px | 17px | Barlow 400, `--color-fg-body` |
| kicker | 12px | 13px | Barlow 500, UPPERCASE, `tracking: .22em`, `--color-accent` |
| price | 20px | 24px | Barlow 600, `tabular-nums`, `--color-accent` |

**Uppercase rules — these are what separate this look from a shouty one:**
- Uppercase is for the hero, section H2s, kickers, nav and buttons. **Never** for body copy,
  service descriptions, form labels, error messages or anything longer than ~40 characters.
  All-caps German destroys the word-shape cues readers rely on and slows reading measurably.
- Always pair `text-transform: uppercase` with positive `letter-spacing` (.02em display, .22em kickers).
  Uppercase at default tracking looks cramped.
- Keep the ß: `Jahnstraße` uppercases to `JAHNSTRASSE` in CSS, which is correct German. But for a
  proper noun in a heading, prefer writing it as displayed rather than transforming.

**German-language rules:**
- `lang="de"` on `<html>`. Hyphenation is **scoped**: `p, li { hyphens: auto; hyphenate-limit-chars: 8 4 4; }`.
  Headings and hero/lead paragraphs use `hyphens: manual` — a hyphenated H1 looks like a typo.
  Verified at 375px: without the limit, a 4-line lead hyphenated 3 times.
- Headlines: `max-inline-size: 16ch; text-wrap: balance`. Condensed type fits more per line, so the
  measure is tighter than a normal-width face would need.
- Buttons/chips never fixed-width: `min-w-0 whitespace-nowrap` on the label, `shrink-0` on the icon.
- Prices Austrian: `25,00 €`.

### Spacing (Density 4/10 — Standard)

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` | Tight gaps |
| `--space-sm` | `8px` | Icon gaps |
| `--space-md` | `16px` | Standard padding |
| `--space-lg` | `24px` | Card padding |
| `--space-xl` | `32px` | Large gaps |
| `--space-2xl` | `48px` | — |
| `--space-3xl` | `64px` | — |

**Section rhythm:** `padding-block: 72px` mobile → `120px` desktop. The reference's presence comes
mostly from vertical air; cramped sections are what make a dark site look cheap.
Container `max-width: 1200px`, `padding-inline: 16px` → `24px` (≥768px).

### Radius & Elevation

Radius: `--radius-sm 4px` (chips, inputs) · `--radius-md 6px` (buttons) · `--radius-lg 10px` (cards)
· `--radius-xl 14px` (modals). Tighter than v1 — the sharper corners read as barbering, not as SaaS.

| Level | Value | Usage |
|---|---|---|
| `--shadow-md` | `0 4px 12px rgba(0,0,0,.5)` | Dropdowns |
| `--shadow-lg` | `0 16px 40px rgba(0,0,0,.6)` | Modal, lightbox |

No shadow on flat cards — use `--color-surface` + `--color-border`.

---

## Style Guidelines

**Style:** Dark Mode (OLED) (verified — `cost:low | drivers:none`) applied through the **Editorial Grid /
Magazine** layout discipline (verified — `cost:low | drivers:none`, `css-grid|tailwind`).

**Applied as:**
- Full-bleed photographic hero, near-black overlay `linear-gradient(rgba(14,13,12,.35), rgba(14,13,12,.92))`
  so the headline sits on the darkest part and the room still reads behind it.
- Gold uppercase kicker above every section heading, plus a 48×2px gold rule.
- Cards: `--color-surface`, 1px `--color-border`, no shadow; hover lifts to `--color-surface-2`.
- Photography carries the page. Warm tungsten interior shots, high contrast, no filters, no gradients
  over content, no glassmorphism, no blur.
- A thin gold hairline (`1px`, `--color-accent` at 30% alpha) as the section divider — not a full-width
  solid rule.

**Rejected:** Liquid Glass (`cost:moderate | drivers:animation,blur`), Parallax Storytelling
(`cost:high | drivers:animation,large-images`), Vintage Analog (film-grain filters). All three
collide with the brief's performance budget (`info.md` §24), and the client's reference achieves its
depth through photography and spacing, not effects.

### Page Pattern

**Trust & Authority + Conversion** (verified), over the section order `info.md` §3 mandates.
See `pages/home.md` for the full section table.

- CTA: gold "Termin buchen" in the header, in the hero, closing each major section, and a final band.
  Every one goes to `/booking`.
- Color strategy: near-black base, gold reserved for CTA and kickers only.

---

## Component Specs

```css
:root {
  color-scheme: dark;
  --color-bg:#0E0D0C; --color-surface:#1A1816; --color-surface-2:#22201D;
  --color-fg:#FFFFFF; --color-fg-body:#D6D3D1; --color-fg-muted:#A8A29E;
  --color-accent:#D4AF37; --color-accent-hover:#E0B44C; --color-on-accent:#0E0D0C;
  --color-border:#2A2724; --color-border-strong:#6B6560;
  --color-ring:#D4AF37; --color-destructive:#F87171;
  --radius-sm:4px; --radius-md:6px; --radius-lg:10px; --radius-xl:14px;
}
body { background: var(--color-bg); color: var(--color-fg-body); }

/* Primary CTA — gold fill, DARK label. Never a white label on gold. */
.btn-primary {
  background: var(--color-accent); color: var(--color-on-accent);
  min-height: 48px; padding: 12px 24px; border: 0; border-radius: var(--radius-md);
  font: 600 15px/1 Barlow, sans-serif; text-transform: uppercase; letter-spacing: .06em;
  cursor: pointer; transition: background-color 200ms ease;
}
.btn-primary:hover { background: var(--color-accent-hover); }
.btn-primary:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 3px; }

/* Secondary — gold outline on dark */
.btn-secondary {
  background: transparent; color: var(--color-accent);
  border: 1px solid var(--color-accent);
  min-height: 48px; padding: 12px 24px; border-radius: var(--radius-md);
  font: 600 15px/1 Barlow, sans-serif; text-transform: uppercase; letter-spacing: .06em;
  cursor: pointer; transition: background-color 200ms ease, color 200ms ease;
}
.btn-secondary:hover { background: var(--color-accent); color: var(--color-on-accent); }

.card {
  background: var(--color-surface); color: var(--color-fg-body);
  border: 1px solid var(--color-border); border-radius: var(--radius-lg);
  padding: var(--space-lg);
  transition: background-color 200ms ease, border-color 200ms ease;
}
.card:hover { background: var(--color-surface-2); border-color: var(--color-border-strong); }
/* Elevation via surface lightness. No translateY — it shifts layout on touch. */

.input {
  min-height: 48px; padding: 12px 16px; font-size: 16px; font-family: Barlow, sans-serif;
  background: var(--color-surface); color: var(--color-fg);
  border: 1px solid var(--color-border-strong);   /* 3:1 — WCAG 1.4.11 */
  border-radius: var(--radius-sm);
  transition: border-color 200ms ease;
}
.input::placeholder { color: var(--color-fg-muted); }  /* 7:1 — never a dim hint */
.input:focus-visible { border-color: var(--color-accent); outline: 3px solid var(--color-accent); outline-offset: 1px; }
.input[aria-invalid="true"] { border-color: var(--color-destructive); }

.modal { background: var(--color-surface); border: 1px solid var(--color-border);
         border-radius: var(--radius-xl); padding: var(--space-xl); box-shadow: var(--shadow-lg);
         max-width: 500px; width: min(90vw, 500px); }
.modal-overlay { background: rgba(0,0,0,.75); }  /* no backdrop-filter — perf budget */
```

**Focus rings on dark:** gold at 9.23:1, 3px, `outline-offset: 3px`. On a dark page a 1px ring
disappears — this is the most commonly broken thing in dark themes. Never `outline: none`.

**Touch targets:** ≥ 48×48px, ≥ 8px apart.

**Icons:** Heroicons or Lucide SVG outline, `stroke-width: 1.5`, `currentColor`, one family site-wide.
On dark, hairline icon strokes vanish — never go below 1.5. No emoji as icons.

---

## Imagery — the load-bearing element

This design is 70% photography. It fails without real photos, and no amount of CSS compensates.

- Warm tungsten interior, close-crop cuts and beard work, hands-at-work shots. Dark, high-contrast,
  consistent white balance across the set — a mixed-temperature gallery is what makes a dark site
  look assembled from stock.
- **No stock photography.** A generic barber-pole image next to real shop photos reads instantly as fake.
- Every photo gets a subtle dark scrim where text overlays it, never text directly on a busy image.
- Format AVIF → WebP → JPEG via `<picture>`; explicit `width`/`height`; `loading="lazy"` below the fold.
- Hero image: `fetchpriority="high"`, preloaded, **not** lazy — it is the LCP element.

---

## Motion (Dial 3/10 — Subtle)

**No GSAP on the public site** (`info.md` §2, §24 — ~70 kB for a fade the platform does natively).

```css
@media (prefers-reduced-motion: no-preference) {
  .reveal { opacity:0; transform: translateY(14px);
            transition: opacity 400ms ease-out, transform 400ms ease-out; }
  .reveal.is-visible { opacity:1; transform:none; }
}
```

```js
const io = new IntersectionObserver((es, obs) => {
  for (const e of es) if (e.isIntersecting) { e.target.classList.add('is-visible'); obs.unobserve(e.target); }
}, { rootMargin: '0px 0px -10% 0px' });
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.querySelectorAll('[data-reveal]').forEach(el => { el.classList.add('reveal'); io.observe(el); });
}
```

- Content is in the DOM and **visible without JS** — the class is added by script, so crawlers and
  no-JS users never get a blank page.
- Transform and opacity only. Never `width`/`height`/`top`.
- Nothing moves on `/booking` or `/admin` beyond state transitions (150–250ms).
- No parallax, no scroll-scrub, no counters animating on scroll.

---

## Performance Budget (`info.md` §24, §39)

- Home page **< 100 kB JS**, target < 30 kB. Booking and admin JS live on their own routes.
- First viewport ≤ 400 kB of media. Dark photography compresses well — use it.
- Fonts: 5 weights total (Barlow Condensed 600/700, Barlow 400/500/600), `display=swap`, both preconnects.
- Video (`info.md` §25): `poster` required, `preload="none"`, `muted playsinline`, never autoplay under
  reduced motion, never the LCP element.
- Targets LCP < 2.5s · INP < 200ms · CLS < 0.1.

---

## Accessibility Floor (`info.md` §27)

- Text ≥ 4.5:1 (table above, all verified); form/UI boundaries ≥ 3:1.
- Gold button = dark label. Non-negotiable.
- `:focus-visible` gold ring, 3px, offset 3px, on every interactive element.
- Every input has a real `<label for>`. Placeholders are never labels, and placeholder text uses
  `--color-fg-muted` (7:1), not a dim gray.
- Errors beside their field, `aria-describedby`, announced `aria-live="polite"`.
- Icon-only controls carry a German `aria-label` (`aria-label="Menü öffnen"`). Decorative icons
  beside visible text get `aria-hidden="true"`.
- `prefers-reduced-motion: reduce` → no reveals, no video autoplay.
- Skip link to `#main` as the first focusable element — visible on focus, gold on near-black.

---

## Responsive (`info.md` §28)

Verify at **320, 375, 390, 430, 768, 1024, 1280, 1440, 1920**. Mobile-first. No fixed px container
widths (`w-full md:max-w-xl`, never `w-[900px]`). No horizontal overflow at any width — check
`document.documentElement.scrollWidth === innerWidth`.

---

## Anti-Patterns (Do NOT Use)

- ❌ **White text on the gold button** (2.10:1) — the defining failure of this palette
- ❌ **`#A16207` anywhere** — the retired v1 gold, 3.94:1 on dark
- ❌ Pure `#000000` page background · shadows used as dark-mode elevation
- ❌ Uppercase body copy or uppercase German longer than ~40 characters
- ❌ Uppercase without letter-spacing
- ❌ Gold as a large fill or as body text
- ❌ Stock photography · mixed white balance across the gallery
- ❌ Glassmorphism, backdrop-blur, parallax, film-grain filters, animated counters
- ❌ Emoji as icons · icon strokes below 1.5px on dark
- ❌ Dim placeholder text used as the label
- ❌ 1px focus rings · `outline: none`
- ❌ Booking or admin JS on the home page
- ❌ **Invented trust numbers or fabricated reviews** (see `pages/home.md`)

---

## Pre-Delivery Checklist

- [ ] Gold buttons have dark (`#0E0D0C`) labels, never white
- [ ] No `#A16207` remains anywhere in the codebase
- [ ] Body text `#D6D3D1` / muted `#A8A29E` — no dimmer gray on gray
- [ ] Form control borders use `--color-border-strong`, not `--color-border`
- [ ] Gold focus ring, 3px, offset 3px, visible on every interactive element
- [ ] Uppercase only on hero/H2/kicker/nav/buttons — never body copy
- [ ] Uppercase always paired with letter-spacing
- [ ] Icons ≥ 1.5 stroke width, one family, no emoji
- [ ] Real photography, consistent white balance, dark scrim under overlaid text
- [ ] Hero image `fetchpriority="high"`, not lazy; everything below the fold lazy
- [ ] `prefers-reduced-motion` respected
- [ ] Touch targets ≥ 48×48px, ≥ 8px apart
- [ ] 320 → 1920 with no horizontal scroll
- [ ] `lang="de"`, scoped `hyphens`, prices `25,00 €`
- [ ] No placeholder stats or invented reviews on the page
