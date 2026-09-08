# `/booking` — Page Overrides

> Rules here **override** `../MASTER.md`. Everything not listed follows the Master.
> **Page type:** transactional multi-step form (NOT a marketing page, NOT a dashboard).

The generator classified this as "Dashboard / Data View" with a marketing hero and red/orange/green
step colors — both rejected. `info.md` §6 requires the lightest possible page whose only job is to
complete a booking.

---

## Layout

- **Max width:** `560px`, centered. Not 1400px, not full-width.
- Single column at every breakpoint. No sidebar, no hero, no gallery, no Instagram embed.
- Header: shop name + back-link only. No full site nav. Footer: phone + Impressum links only.
- Section order: **Service → Mitarbeiter → Datum → Uhrzeit → Ihre Daten → Bestätigen** (`info.md` §7, §13).

## Density & Motion

- **Density 5/10** — compact but finger-friendly. Time-slot chips ≥ 48×48px, gap 8px.
- **Motion 1/10** — state transitions only (150–250ms). No scroll reveals. No `data-reveal` on this page.

## Typography

- **Barlow only.** Do NOT load Barlow Condensed on `/booking` — it saves a font file on the one page
  where time-to-interactive matters most. Step headings: Barlow 600, 20px, **sentence case**.
- No uppercase on this page except the submit button. A booking form is a reading task.

## Color

- Same dark surfaces as the rest of the site (`--color-bg` page, `--color-surface` panels) — the
  booking page stays on-brand; only the marketing chrome is stripped, not the theme.
- Gold `--color-accent` marks **only** the active step and the final "Termin bestätigen" button.
  That button is gold fill with a **dark `#0E0D0C` label** (white on gold = 2.10:1, fails).
- Step colors are **not** semantic red/orange/green. Steps use: done = `--color-accent` at 55% alpha,
  current = `--color-accent`, upcoming = `--color-fg-muted`.
- Slot states — never color alone (`info.md` §27, WCAG 1.4.1):
  | State | Fill | Text | Non-color cue |
  |---|---|---|---|
  | Frei | `--color-surface` + `--color-border-strong` | `--color-fg` | selectable, normal weight |
  | Gewählt | `--color-accent` | `#0E0D0C` | check icon + `aria-pressed="true"` |
  | Belegt | `rgba(255,255,255,.05)` → `#252422` | `--color-fg-muted` (6.15:1) | `disabled` + strikethrough + `aria-disabled` |

## Required States (`info.md` §35 — all four, every async step)

| State | Requirement |
|---|---|
| **Loading** | Skeleton slot grid (not a spinner) while free/busy loads. `aria-busy="true"` on the region. |
| **Success** | Confirmation screen with service, barber, date, time, address — plus "Zum Kalender hinzufügen" (.ics). |
| **Error** | Plain German, no stack traces: „Dieser Termin ist leider nicht mehr frei. Bitte wählen Sie eine andere Uhrzeit."  Re-fetch slots automatically. |
| **Empty** | „An diesem Tag sind keine Termine mehr frei." + next-available-day suggestion, never a blank grid. |

## The double-booking race (`info.md` §16) is a UI requirement, not just backend

On `409 Conflict` from the create call: keep the customer's entered data, mark the taken slot as
`Belegt`, refresh the grid, move focus to the slot list, and announce the message via `aria-live="assertive"`.
Never silently reset the form. Never show a success state for a booking the backend did not confirm.

## Progress indicator (verified UX rule: "Progress Indicators", severity Medium)

`Schritt 2 von 5` visible at all times, as text + a bar. `aria-current="step"` on the active item.
Back must be non-destructive — returning to step 2 keeps the step-3 choice.

## Forms (verified UX rules: "Form Labels" + "Submit Feedback", both severity High)

- Real `<label for>` on every field. Placeholder-only inputs are forbidden.
- Fields: Name, E-Mail, Telefon, optional Anmerkung. `type="email"`, `type="tel"`,
  `autocomplete="name | email | tel"`, `inputmode="tel"`.
- `font-size: 16px` minimum on inputs — smaller triggers iOS zoom on focus.
- Validate on blur, not on keystroke. Error message next to the field, `aria-describedby`.
- Submit button shows loading → success/error, and is disabled while in flight to prevent double submits.

## Timezone (`info.md` §23)

All times render in **Europe/Vienna** regardless of the visitor's device clock. Label the day explicitly
(`Mo., 14. Sept.`) so a traveller cannot misread it. Never format with the raw device offset.

## Performance

- This route loads its own JS bundle only. No home-page assets, no map embed, no Instagram script.
- Service and barber lists come from the backend (`info.md` §7 — no hardcoded barbers in frontend).
- Deep-link support: `/booking?service=herren-haarschnitt` preselects step 1 from the price list CTA.
