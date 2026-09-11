/* Home-page behaviour: opening hours, price list, consent-gated map, Google reviews.
   No booking or admin code is loaded here; die Galerie lebt auf /galerie.html.

   Öffnungszeiten und Preisliste kommen aus /api/business, also aus dem, was in
   der Verwaltung gepflegt wird. Das statische HTML ist der Rückfall für
   Crawler, Besucher ohne JavaScript und einen nicht erreichbaren Server. */
(() => {
  'use strict';

  const esc = window.BB.esc;

  const DAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const DAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const DAY_SCHEMA = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const WEEK = [1, 2, 3, 4, 5, 6, 0];

  /* Rückfall bis /api/business antwortet — deckt sich mit dem HTML. */
  let hours = {
    0: [],
    1: [['09:00', '19:00']],
    2: [['09:00', '19:00']],
    3: [['09:00', '19:00']],
    4: [['09:00', '19:00']],
    5: [['09:00', '19:00']],
    6: [['09:00', '18:00']],
  };
  let timezone = 'Europe/Vienna';
  let address = 'Jahnstraße 9, 6900 Bregenz';

  /* ---------- Opening hours ----------
     Computed in the business timezone, never from the visitor's device clock
     (info.md §23) — a traveller must not see "geöffnet" at the wrong local hour. */
  function nowInZone() {
    let parts;
    try {
      parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date());
    } catch {
      parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Vienna', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date());
    }
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      day: days[get('weekday')] ?? new Date().getDay(),
      minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
    };
  }

  const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };

  const hoursList = document.querySelector('[data-hours]');
  const stateWrap = document.querySelector('[data-open-state]');
  const badge = document.querySelector('[data-open-badge]');
  const summary = document.querySelector('[data-hours-summary]');

  /** "Mo–Fr 09:00–19:00 · Sa 09:00–18:00 · So geschlossen" */
  function summaryText() {
    const groups = [];
    for (const day of WEEK) {
      const key = (hours[day] || []).map(([s, e]) => `${s}–${e}`).join(', ') || 'geschlossen';
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.days.push(day);
      else groups.push({ key, days: [day] });
    }
    return groups
      .map(({ key, days }) => `${DAY_SHORT[days[0]]}${days.length > 1 ? `–${DAY_SHORT[days[days.length - 1]]}` : ''} ${key}`)
      .join(' · ');
  }

  function renderHours(rebuild) {
    if (hoursList && rebuild) {
      hoursList.innerHTML = WEEK.map((day, index) => {
        const intervals = hours[day] || [];
        return `<div data-day="${day}" class="flex items-baseline justify-between gap-4 rounded-sm px-3 py-2.5${index < WEEK.length - 1 ? ' border-b border-line' : ''}">
            <dt>${DAY_NAMES[day]}</dt>
            ${intervals.length
              ? `<dd class="tnum text-right">${intervals.map(([s, e]) => `${esc(s)} – ${esc(e)}`).join('<br />')}</dd>`
              : '<dd class="text-fg-muted">Geschlossen</dd>'}
          </div>`;
      }).join('');
    }
    if (summary && rebuild) summary.textContent = summaryText();

    const { day, minutes } = nowInZone();
    hoursList?.querySelector(`[data-day="${day}"]`)?.classList.add('bg-surface-2', 'text-fg', 'font-semibold');
    const isOpen = (hours[day] || []).some(([s, e]) => minutes >= toMinutes(s) && minutes < toMinutes(e));

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

  if (hoursList || badge) renderHours(false);

  /* ---------- Preisliste ----------
     Aktive Leistungen, gruppiert nach Kategorie in der Reihenfolge aus der
     Verwaltung. Markup wie im statischen HTML. */
  function serviceCard(service) {
    const meta = [`${service.durationMinutes} Min.`];
    if (service.employees?.length) meta.push(service.employees.join(', '));
    return `<li class="card card-hover flex flex-col gap-2">
        <div class="flex items-start justify-between gap-4">
          <h3 class="min-w-0 font-sans text-[19px] font-semibold leading-snug text-fg">${esc(service.name)}</h3>
          <span class="tnum shrink-0 font-sans text-xl font-semibold text-accent">${window.BB.price(service.priceCents)}</span>
        </div>
        ${service.description ? `<p class="text-[15px] text-fg-muted">${esc(service.description)}</p>` : ''}
        <p class="text-[13px] font-medium uppercase tracking-[0.08em] text-fg-muted">${esc(meta.join(' · '))}</p>
        <a href="/booking.html?service=${encodeURIComponent(service.slug)}" class="btn-secondary mt-2 self-start">Termin buchen</a>
      </li>`;
  }

  function renderServices(services) {
    const box = document.querySelector('[data-services]');
    if (!box) return;
    if (!services.length) {
      box.innerHTML = '<p class="mt-12 text-fg-muted">Aktuell sind keine Leistungen online buchbar. Ruf uns gerne an.</p>';
      return;
    }
    const groups = new Map();
    for (const service of services) {
      const category = service.category || 'Weitere Leistungen';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(service);
    }
    box.innerHTML = [...groups].map(([category, items], index) => `
        <h3 class="${index ? 'mt-14' : 'mt-12'} font-display text-2xl font-bold uppercase tracking-wide text-fg">${esc(category)}</h3>
        <hr class="rule" />
        <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">${items.map(serviceCard).join('')}</ul>`).join('');
  }

  /* ---------- Strukturierte Daten ----------
     Dieselben Angaben wie sichtbar auf der Seite, damit Suchmaschinen, die
     JavaScript ausführen, keine veralteten Zeiten oder Nummern sehen. */
  function updateStructuredData(business) {
    const script = document.querySelector('script[type="application/ld+json"]');
    if (!script) return;
    try {
      const data = JSON.parse(script.textContent);
      if (business.name) data.name = business.name;
      if (business.phone) data.telephone = window.BB.telHref(business.phone).slice(4);
      if (business.email) data.email = business.email;
      const parts = /^(.+?),\s*(\d{4,5})\s+(.+)$/.exec(business.address || '');
      if (parts && data.address) {
        Object.assign(data.address, { streetAddress: parts[1], postalCode: parts[2], addressLocality: parts[3] });
      }
      data.openingHoursSpecification = WEEK.flatMap((day) => (hours[day] || []).map(([opens, closes]) => ({
        '@type': 'OpeningHoursSpecification', dayOfWeek: DAY_SCHEMA[day], opens, closes,
      })));
      script.textContent = JSON.stringify(data, null, 2);
    } catch {
      /* Unlesbar oder unerwartet: die statische Fassung bleibt. */
    }
  }

  window.BB.business()
    .then((data) => {
      if (data?.business?.timezone) timezone = data.business.timezone;
      if (data?.business?.address) address = data.business.address;
      if (Array.isArray(data?.openingHours)) {
        hours = Object.fromEntries(data.openingHours.map((d) => [d.weekday, d.intervals || []]));
        if (hoursList || badge || summary) renderHours(true);
      }
      if (Array.isArray(data?.services)) renderServices(data.services);
      if (data?.business) updateStructuredData(data.business);
    })
    .catch(() => {
      /* Rückfall: Öffnungszeiten und Preisliste aus dem HTML bleiben stehen. */
    });

  /* ---------- Google Maps: click to load ----------
     Not on first paint — heaviest third-party asset on the site and it sets
     cookies. See pages/home.md. */
  const mapWrap = document.querySelector('[data-map]');
  const mapBtn = document.querySelector('[data-map-load]');
  if (mapWrap && mapBtn) {
    mapBtn.addEventListener('click', () => {
      const frame = document.createElement('iframe');
      frame.src = `https://www.google.com/maps?q=${encodeURIComponent(`${address}, Österreich`)}&output=embed`;
      frame.title = `Karte: ${address}`;
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
    const reviewSummary = reviewsSection.querySelector('[data-reviews-summary]');
    const rule = document.querySelector('[data-reviews-rule]');

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
          reviewSummary.querySelector('[data-reviews-stars]').textContent = stars(data.rating);
          reviewSummary.querySelector('[data-reviews-rating]').textContent =
            Number(data.rating).toLocaleString('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
          reviewSummary.querySelector('[data-reviews-count]').textContent = String(data.total);
          reviewSummary.hidden = false;
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
