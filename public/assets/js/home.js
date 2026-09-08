/* Home-page behaviour: opening-hours state, consent-gated map, Google reviews.
   No booking or admin code is loaded here; die Galerie lebt auf /galerie.html. */
(() => {
  'use strict';

  const TZ = 'Europe/Vienna';

  /* ---------- Opening hours ----------
     Computed in the business timezone, never from the visitor's device clock
     (info.md §23) — a traveller must not see "geöffnet" at the wrong local hour. */
  const HOURS = {
    0: null,                      // Sonntag geschlossen
    1: ['09:00', '19:00'],
    2: ['09:00', '19:00'],
    3: ['09:00', '19:00'],
    4: ['09:00', '19:00'],
    5: ['09:00', '19:00'],
    6: ['09:00', '18:00'],
  };

  function viennaNow() {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      day: days[get('weekday')] ?? new Date().getDay(),
      minutes: Number(get('hour')) * 60 + Number(get('minute')),
    };
  }

  const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };

  const hoursList = document.querySelector('[data-hours]');
  const stateWrap = document.querySelector('[data-open-state]');
  const badge = document.querySelector('[data-open-badge]');

  if (hoursList || badge) {
    const { day, minutes } = viennaNow();
    const today = HOURS[day];
    const isOpen = Boolean(today) && minutes >= toMinutes(today[0]) && minutes < toMinutes(today[1]);

    hoursList?.querySelector(`[data-day="${day}"]`)?.classList.add('bg-surface-2', 'text-fg', 'font-semibold');

    if (badge && stateWrap) {
      // Icon + text, never colour alone (WCAG 1.4.1).
      const icon = isOpen
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
      badge.innerHTML = `${icon}<span>${isOpen ? 'Jetzt geöffnet' : 'Gerade geschlossen'}</span>`;
      badge.style.background = isOpen ? 'rgba(74,222,128,.16)' : 'rgba(168,162,158,.16)';
      badge.style.color = isOpen ? '#4ADE80' : '#A8A29E';
      stateWrap.hidden = false;
    }
  }

  /* ---------- Google Maps: click to load ----------
     Not on first paint — heaviest third-party asset on the site and it sets
     cookies. See pages/home.md. */
  const mapWrap = document.querySelector('[data-map]');
  const mapBtn = document.querySelector('[data-map-load]');
  if (mapWrap && mapBtn) {
    mapBtn.addEventListener('click', () => {
      const frame = document.createElement('iframe');
      frame.src =
        'https://www.google.com/maps?q=' +
        encodeURIComponent('Jahnstraße 9, 6900 Bregenz, Österreich') +
        '&output=embed';
      frame.title = 'Karte: Jahnstraße 9, 6900 Bregenz';
      frame.loading = 'lazy';
      frame.referrerPolicy = 'no-referrer-when-downgrade';
      frame.className = 'absolute inset-0 h-full w-full border-0';
      frame.style.colorScheme = 'dark';
      mapWrap.querySelector('[data-map-placeholder]')?.remove();
      mapWrap.appendChild(frame);
      frame.focus();
    });
  }

  /* ---------- Google reviews ----------
     Rendered ONLY from real Google Business Profile data. If the endpoint is
     missing, errors, or returns nothing, the whole block stays hidden — no
     placeholder rating, no sample quotes. See pages/home.md → data gate. */
  const reviewsSection = document.querySelector('[data-reviews]');
  if (reviewsSection) {
    const list = reviewsSection.querySelector('[data-reviews-list]');
    const summary = reviewsSection.querySelector('[data-reviews-summary]');
    const rule = document.querySelector('[data-reviews-rule]');
    const esc = window.BB.esc;

    const stars = (rating) => {
      const full = Math.round(Number(rating) || 0);
      return '★'.repeat(Math.min(5, full)) + '☆'.repeat(Math.max(0, 5 - full));
    };

    window.BB.getJSON('/api/reviews')
      .then((data) => {
        const reviews = Array.isArray(data?.reviews) ? data.reviews.filter((r) => r?.text) : [];
        if (!reviews.length) return; // stays hidden

        list.innerHTML = reviews
          .slice(0, 3)
          .map(
            (r) => `
            <li class="card">
              <p class="text-accent" aria-hidden="true">${stars(r.rating)}</p>
              <p class="sr-only">${esc(r.rating)} von 5 Sternen</p>
              <blockquote class="mt-3 text-[15px] text-fg-body">${esc(r.text)}</blockquote>
              <p class="mt-4 text-[13px] uppercase tracking-[0.12em] text-fg-muted">${esc(r.author)}</p>
            </li>`
          )
          .join('');

        if (data.rating && data.total) {
          summary.querySelector('[data-reviews-stars]').textContent = stars(data.rating);
          summary.querySelector('[data-reviews-rating]').textContent =
            Number(data.rating).toLocaleString('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
          summary.querySelector('[data-reviews-count]').textContent = String(data.total);
          summary.hidden = false;
        }

        const link = reviewsSection.querySelector('[data-reviews-link]');
        if (data.profileUrl) link.href = data.profileUrl;
        else link.remove();

        reviewsSection.hidden = false;
        if (rule) rule.hidden = false;
      })
      .catch(() => {
        /* Endpoint not deployed yet, offline, or no reviews: block stays hidden.
           This is the intended state, not an error the visitor should see. */
      });
  }

})();
