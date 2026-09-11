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
  /* Feiertage und Schließtage aus der Verwaltung: Map<YYYY-MM-DD, Name>. */
  let closedDays = new Map();

  function todayInZone() {
    const format = (zone) => new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    try {
      return format(timezone);
    } catch {
      return format('Europe/Vienna');
    }
  }

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

  /** Eine Zeile je Gruppe: "Mo–Fr 09:00–19:00", "Sa 09:00–18:00", "So geschlossen". */
  function summaryLines() {
    const groups = [];
    for (const day of WEEK) {
      const key = (hours[day] || []).map(([s, e]) => `${s}–${e}`).join(', ') || 'geschlossen';
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.days.push(day);
      else groups.push({ key, days: [day] });
    }
    return groups
      .map(({ key, days }) => `${DAY_SHORT[days[0]]}${days.length > 1 ? `–${DAY_SHORT[days[days.length - 1]]}` : ''} ${key}`);
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
    if (summary && rebuild) {
      summary.innerHTML = summaryLines().map((line) => `<span class="block">${esc(line)}</span>`).join('');
    }

    const { day, minutes } = nowInZone();
    hoursList?.querySelector(`[data-day="${day}"]`)?.classList.add('bg-surface-2', 'text-fg', 'font-semibold');
    // Feiertag oder Schließtag: geschlossen, egal was die Arbeitszeiten sagen.
    const holiday = closedDays.get(todayInZone());
    const isOpen = !holiday && (hours[day] || []).some(([s, e]) => minutes >= toMinutes(s) && minutes < toMinutes(e));

    if (badge && stateWrap) {
      // Icon + text, never colour alone (WCAG 1.4.1).
      // Geöffnet grün, geschlossen rot — dieselben Statusfarben wie in der Verwaltung.
      const icon = isOpen
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>';
      const label = isOpen ? 'Jetzt geöffnet' : holiday ? `Heute geschlossen – ${esc(holiday)}` : 'Gerade geschlossen';
      badge.innerHTML = `${icon}<span>${label}</span>`;
      badge.style.background = isOpen ? 'rgba(74,222,128,.16)' : 'rgba(248,113,113,.16)';
      badge.style.color = isOpen ? '#4ADE80' : '#F87171';
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

  /* ---------- Team-Slider ----------
     Eine Folie je aktivem Mitarbeiter mit Profil aus der Verwaltung. Blättern per
     Wischen (Scroll-Snap), Pfeiltasten-Knöpfen oder Punkten. Kein Autoplay: der
     Text soll in Ruhe gelesen werden können. */
  const team = document.querySelector('[data-team]');

  const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]).join('').toUpperCase();

  function workdaysText(days) {
    const ordered = WEEK.filter((day) => days.includes(day));
    if (!ordered.length) return null;
    const positions = ordered.map((day) => WEEK.indexOf(day));
    const consecutive = positions.every((pos, i) => i === 0 || pos === positions[i - 1] + 1);
    return consecutive && ordered.length > 2
      ? `${DAY_SHORT[ordered[0]]} – ${DAY_SHORT[ordered[ordered.length - 1]]}`
      : ordered.map((day) => DAY_SHORT[day]).join(', ');
  }

  function tile(label, value, detail, wide) {
    return `<div class="card${wide ? ' col-span-2 sm:col-span-1' : ''}">
        <dt class="text-[13px] uppercase tracking-[0.12em] text-fg-muted">${esc(label)}</dt>
        <dd class="mt-1 font-display text-2xl font-bold uppercase text-accent">${esc(value)}</dd>
        ${detail ? `<dd class="mt-1 text-sm text-fg-muted">${esc(detail)}</dd>` : ''}
      </div>`;
  }

  function teamSlide(member, index, total) {
    const tiles = [];
    if (member.languages?.length) {
      tiles.push(['Sprachen', String(member.languages.length), member.languages.join(' · ')]);
    }
    if (member.workdays?.length) {
      tiles.push(['Im Salon', `${member.workdays.length} ${member.workdays.length === 1 ? 'Tag' : 'Tage'}`, workdaysText(member.workdays)]);
    }
    if (Number.isInteger(member.experienceYears) && member.experienceYears > 0) {
      tiles.push(['Erfahrung', `${member.experienceYears} ${member.experienceYears === 1 ? 'Jahr' : 'Jahre'}`, null]);
    }
    const paragraphs = String(member.bio || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const kicker = member.headline
      ? [member.role, member.name].filter(Boolean).join(' · ')
      : (member.role || 'Unser Team');

    const photo = member.photoUrl
      ? `<img src="${esc(member.photoUrl)}" alt="${esc(member.name)}" width="1050" height="1400" loading="lazy" decoding="async"
           class="aspect-[3/4] w-full rounded-lg border border-line object-cover" />`
      : `<div class="grid aspect-[3/4] w-full place-items-center rounded-lg border border-line bg-surface font-display text-7xl font-bold uppercase text-accent" aria-hidden="true">${esc(initials(member.name))}</div>`;

    return `<article data-team-slide aria-roledescription="slide" aria-label="${index + 1} von ${total}: ${esc(member.name)}"
        class="grid w-full shrink-0 snap-start items-center gap-10 md:grid-cols-2 md:gap-16">
        <div class="order-2 md:order-1">
          <p class="kicker">${esc(kicker)}</p>
          <h2 class="h2">${esc(member.headline || member.name)}</h2>
          <hr class="rule" />
          ${paragraphs.map((p, i) => `<p class="lead${i ? ' mt-4' : ''}">${esc(p).replace(/\n/g, '<br />')}</p>`).join('')}
          ${tiles.length ? `<dl class="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">${tiles
            .map(([label, value, detail], i) => tile(label, value, detail, tiles.length === 3 && i === 2)).join('')}</dl>` : ''}
        </div>
        <div class="order-1 md:order-2">${photo}</div>
      </article>`;
  }

  function setupTeam(members) {
    // Niemand mit Profil: die Folie aus dem HTML bleibt, statt einer leeren Sektion.
    if (!team || !members.length) return;
    const track = team.querySelector('[data-team-track]');
    const controls = team.querySelector('[data-team-controls]');
    const dots = team.querySelector('[data-team-dots]');
    track.innerHTML = members.map((member, i) => teamSlide(member, i, members.length)).join('');
    if (members.length < 2) {
      controls.hidden = true;
      return;
    }

    // Punkte mit 44-px-Trefferfläche; sichtbar ist nur der kleine Kreis.
    dots.innerHTML = members.map((member, i) => `
      <button type="button" data-team-dot="${i}" class="grid h-11 w-11 place-items-center" aria-label="${esc(member.name)} anzeigen">
        <span class="h-3 w-3 rounded-full border border-accent transition-colors"></span>
      </button>`).join('');

    let current = 0;
    // Während der eigenen, weichen Scroll-Animation nicht auf Zwischenstände reagieren.
    let lockedUntil = 0;
    const slides = () => Array.from(track.children);
    const update = () => {
      dots.querySelectorAll('[data-team-dot]').forEach((dot, i) => {
        dot.setAttribute('aria-current', String(i === current));
        dot.firstElementChild.classList.toggle('bg-accent', i === current);
      });
      slides().forEach((slide, i) => slide.setAttribute('aria-hidden', String(i !== current)));
    };
    const go = (index) => {
      current = (index + members.length) % members.length;
      lockedUntil = Date.now() + 700;
      track.scrollTo({ left: current * track.clientWidth, behavior: window.BB.reduceMotion ? 'auto' : 'smooth' });
      update();
    };

    team.querySelector('[data-team-prev]').addEventListener('click', () => go(current - 1));
    team.querySelector('[data-team-next]').addEventListener('click', () => go(current + 1));
    dots.addEventListener('click', (event) => {
      const dot = event.target.closest('[data-team-dot]');
      if (dot) go(Number(dot.dataset.teamDot));
    });

    let frame = 0;
    track.addEventListener('scroll', () => {
      if (Date.now() < lockedUntil) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const index = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        if (index !== current && index >= 0 && index < members.length) {
          current = index;
          update();
        }
      });
    }, { passive: true });
    window.addEventListener('resize', () => track.scrollTo({ left: current * track.clientWidth }), { passive: true });

    controls.hidden = false;
    update();
  }

  /* ---------- Google Maps: Klick auf "Karte laden" ----------
     Nicht beim Seitenaufruf — schwerstes Element der Seite, und Google erhält
     erst dann Daten. Gezeigt wird die Adresse aus der Verwaltung. */
  const mapWrap = document.querySelector('[data-map]');
  const mapSrc = () => `https://www.google.com/maps?q=${encodeURIComponent(`${address}, Österreich`)}&output=embed`;

  function loadMap() {
    if (!mapWrap || mapWrap.querySelector('iframe')) return;
    const frame = document.createElement('iframe');
    frame.src = mapSrc();
    frame.title = `Karte: ${address}`;
    frame.loading = 'lazy';
    frame.referrerPolicy = 'no-referrer-when-downgrade';
    frame.className = 'absolute inset-0 h-full w-full border-0';
    frame.style.colorScheme = 'dark';
    mapWrap.querySelector('[data-map-placeholder]')?.remove();
    mapWrap.appendChild(frame);
    frame.focus();
  }

  /** Adresse aus der Verwaltung kam erst nach dem Laden der Karte an. */
  function refreshMap() {
    const frame = mapWrap?.querySelector('iframe');
    if (frame && frame.src !== mapSrc()) {
      frame.src = mapSrc();
      frame.title = `Karte: ${address}`;
    }
  }

  document.querySelector('[data-map-load]')?.addEventListener('click', loadMap);

  window.BB.business()
    .then((data) => {
      if (data?.business?.timezone) timezone = data.business.timezone;
      if (data?.business?.address) address = data.business.address;
      if (Array.isArray(data?.closures)) closedDays = new Map(data.closures.map((c) => [c.date, c.name]));
      if (Array.isArray(data?.openingHours)) {
        hours = Object.fromEntries(data.openingHours.map((d) => [d.weekday, d.intervals || []]));
        if (hoursList || badge || summary) renderHours(true);
      }
      if (Array.isArray(data?.services)) renderServices(data.services);
      if (Array.isArray(data?.team)) setupTeam(data.team);
      if (data?.business) updateStructuredData(data.business);
      refreshMap();
    })
    .catch(() => {
      /* Rückfall: Öffnungszeiten, Preisliste und Team aus dem HTML bleiben stehen. */
    });

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
