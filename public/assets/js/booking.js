/* Buchungsablauf: Leistung → Mitarbeiter → Termin → Daten → Bestätigung.
   Alle Zeiten in Europe/Vienna. Verfügbarkeit kommt ausschließlich vom Backend;
   der Client rechnet keine freien Zeiten selbst aus. */
(() => {
  'use strict';

  const TZ = 'Europe/Vienna';
  const esc = window.BB.esc;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const STEP_NAMES = ['Leistung', 'Mitarbeiter', 'Termin', 'Ihre Daten', 'Bestätigung'];

  const state = {
    step: 1,
    services: [],
    employees: [],
    service: null,
    employee: null,
    date: null,
    slot: null,
    booking: null,
  };

  /* ---------------- Anzeige-Helfer ---------------- */
  // de-AT liefert von Haus aus "€ 25,00". Der Kunde schreibt auf seiner eigenen
  // Seite "25,00 €" — das ist auch die Vorgabe im Design-System.
  const fmtPrice = (cents) =>
    `${new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)}\u00A0€`;

  const fmtDateLong = (iso) =>
    new Intl.DateTimeFormat('de-AT', {
      timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    }).format(new Date(`${iso}T12:00:00`));

  const fmtTime = (isoInstant) =>
    new Intl.DateTimeFormat('de-AT', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
      .format(new Date(isoInstant));

  /** Heutiges Datum in Wien als YYYY-MM-DD — nicht die Gerätezeit des Besuchers. */
  function todayInVienna() {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date());
    const get = (t) => p.find((x) => x.type === t).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  /* ---------------- Schrittsteuerung ---------------- */
  let first = true;
  function goTo(step) {
    state.step = step;
    $$('[data-step]').forEach((el) => { el.hidden = Number(el.dataset.step) !== step; });
    $('[data-step-current]').textContent = String(step);
    $('[data-step-name]').textContent = STEP_NAMES[step - 1];
    $('[data-progress-bar]').style.width = `${(step / STEP_NAMES.length) * 100}%`;
    $$('[data-step-list] li').forEach((li, i) => {
      if (i === step - 1) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    $('[data-progress]').hidden = step === 5;

    // Fokus auf die Überschrift des neuen Schritts, damit Screenreader mitkommen.
    // Beim ersten Rendern nicht — sonst zeigt die Seite direkt beim Laden einen
    // Fokusring, den niemand ausgelöst hat.
    if (!first) {
      const heading = $(`[data-step="${step}"] h2`);
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
      window.scrollTo({ top: 0, behavior: window.BB.reduceMotion ? 'auto' : 'smooth' });
    }
    first = false;
  }

  /** Zurück ist nie destruktiv: getroffene Auswahl bleibt erhalten. */
  $$('[data-back]').forEach((btn) =>
    btn.addEventListener('click', () => goTo(Math.max(1, state.step - 1)))
  );

  /* ---------------- Globaler Fehler ---------------- */
  let retryFn = null;
  function showGlobalError(message, retry) {
    const box = $('[data-global-error]');
    $('[data-global-error-text]').textContent = message;
    retryFn = retry || null;
    $('[data-global-retry]').hidden = !retry;
    box.hidden = false;
  }
  function clearGlobalError() { $('[data-global-error]').hidden = true; }
  $('[data-global-retry]').addEventListener('click', () => { clearGlobalError(); retryFn?.(); });

  /* Nie interne Details zeigen (info.md §35). */
  const FRIENDLY =
    'Die Terminverfügbarkeit ist gerade nicht abrufbar. Bitte versuch es in einem Moment noch einmal ' +
    'oder ruf uns an: 0681 20397906.';

  /* ---------------- Schritt 1: Leistungen ---------------- */
  async function loadServices() {
    const loading = $('[data-services-loading]');
    const list = $('[data-services]');
    const empty = $('[data-services-empty]');
    loading.hidden = false; list.hidden = true; empty.hidden = true;
    try {
      const data = await window.BB.getJSON('/api/services');
      state.services = Array.isArray(data?.services) ? data.services : [];
      if (!state.services.length) { empty.hidden = false; return; }

      list.innerHTML = state.services
        .map(
          (s) => `
          <li>
            <button type="button" data-service-id="${esc(s.id)}"
                    class="card card-hover w-full cursor-pointer text-left">
              <span class="flex items-start justify-between gap-4">
                <span class="min-w-0 font-sans text-[17px] font-semibold text-fg">${esc(s.name)}</span>
                <span class="tnum shrink-0 font-semibold text-accent">${fmtPrice(s.priceCents)}</span>
              </span>
              ${s.description ? `<span class="mt-1 block text-[15px] text-fg-muted">${esc(s.description)}</span>` : ''}
              <span class="mt-2 block text-[13px] font-medium uppercase tracking-[0.08em] text-fg-muted">${esc(s.durationMinutes)} Min.</span>
            </button>
          </li>`
        )
        .join('');
      list.hidden = false;

      // Deep-Link aus der Preisliste: /booking.html?service=herren-haarschnitt
      const wanted = new URLSearchParams(location.search).get('service');
      if (wanted) {
        const match = state.services.find((s) => s.slug === wanted || s.id === wanted);
        if (match) selectService(match);
      }
    } catch {
      showGlobalError(FRIENDLY, loadServices);
    } finally {
      loading.hidden = true;
    }
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-service-id]');
    if (!btn) return;
    const svc = state.services.find((s) => String(s.id) === btn.dataset.serviceId);
    if (svc) selectService(svc);
  });

  function selectService(svc) {
    state.service = svc;
    state.employee = null;
    state.slot = null;
    goTo(2);
    loadEmployees();
  }

  /* ---------------- Schritt 2: Mitarbeiter ----------------
     Immer vom Backend. Deaktivierte Mitarbeiter tauchen hier nicht auf. */
  async function loadEmployees() {
    const loading = $('[data-employees-loading]');
    const list = $('[data-employees]');
    const empty = $('[data-employees-empty]');
    loading.hidden = false; list.hidden = true; empty.hidden = true;
    try {
      const data = await window.BB.getJSON(`/api/employees?serviceId=${encodeURIComponent(state.service.id)}`);
      state.employees = Array.isArray(data?.employees) ? data.employees : [];
      if (!state.employees.length) { empty.hidden = false; return; }

      // Nur ein Mitarbeiter: Schritt überspringen, aber im Fortschritt korrekt zählen.
      if (state.employees.length === 1) {
        state.employee = state.employees[0];
        goTo(3);
        initDateStep();
        return;
      }

      list.innerHTML = state.employees
        .map(
          (emp) => `
          <li>
            <button type="button" data-employee-id="${esc(emp.id)}"
                    class="card card-hover w-full cursor-pointer text-left">
              <span class="font-sans text-[17px] font-semibold text-fg">${esc(emp.name)}</span>
              ${emp.role ? `<span class="mt-1 block text-[15px] text-fg-muted">${esc(emp.role)}</span>` : ''}
            </button>
          </li>`
        )
        .join('');
      list.hidden = false;
    } catch {
      showGlobalError(FRIENDLY, loadEmployees);
    } finally {
      loading.hidden = true;
    }
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-employee-id]');
    if (!btn) return;
    state.employee = state.employees.find((x) => String(x.id) === btn.dataset.employeeId) || null;
    state.slot = null;
    goTo(3);
    initDateStep();
  });

  /* ---------------- Schritt 3: Datum + Uhrzeit ---------------- */
  const dateInput = $('[data-date]');

  function initDateStep() {
    const today = todayInVienna();
    dateInput.min = today;
    const max = new Date(`${today}T12:00:00`);
    max.setDate(max.getDate() + 90);
    dateInput.max = max.toISOString().slice(0, 10);
    if (!dateInput.value) dateInput.value = today;
    state.date = dateInput.value;
    loadSlots();
  }

  dateInput.addEventListener('change', () => {
    state.date = dateInput.value;
    state.slot = null;
    $('[data-next-3]').disabled = true;
    loadSlots();
  });

  // Wechselt das Datum schnell, darf eine ältere, langsamere Antwort die neuere
  // nicht überschreiben — sonst stünde z. B. "keine Termine" am Feiertag.
  let slotsRequest = 0;

  async function loadSlots() {
    const loading = $('[data-slots-loading]');
    const grid = $('[data-slots]');
    const empty = $('[data-slots-empty]');
    const live = $('[data-slots-live]');
    if (!state.date || !state.service || !state.employee) return;
    const request = ++slotsRequest;

    loading.hidden = false; grid.hidden = true; empty.hidden = true;
    clearGlobalError();

    try {
      const params = new URLSearchParams({
        date: state.date,
        serviceId: String(state.service.id),
        employeeId: String(state.employee.id),
      });
      const data = await window.BB.getJSON(`/api/availability?${params}`);
      if (request !== slotsRequest) return; // inzwischen anderes Datum gewählt
      const slots = Array.isArray(data?.slots) ? data.slots : [];

      if (!slots.length) {
        // Leerzustand statt leerem Raster: mit Grund (Feiertag, Schließtag, Ruhetag)
        // und Hinweis auf den nächsten freien Tag. Buchen geht an diesem Tag nicht.
        const reason = data?.closure
          ? `Am ${fmtDateLong(state.date)} ist der Salon geschlossen (${data.closure.name}). An diesem Tag sind keine Termine möglich.`
          : data?.closed
            ? 'An diesem Tag hat der Salon geschlossen.'
            : 'An diesem Tag sind keine Termine mehr frei.';
        $('[data-slots-empty-text]').textContent = reason;
        $('[data-next-free]').textContent = data?.nextAvailableDate
          ? `Der nächste freie Tag ist ${fmtDateLong(data.nextAvailableDate)}.`
          : '';
        empty.hidden = false;
        live.textContent = reason;
        return;
      }

      renderSlots(slots);
      live.textContent = `${slots.filter((s) => s.available).length} freie Zeiten gefunden.`;
    } catch {
      if (request === slotsRequest) showGlobalError(FRIENDLY, loadSlots);
    } finally {
      if (request === slotsRequest) loading.hidden = true;
    }
  }

  function renderSlots(slots) {
    const grid = $('[data-slots]');
    // Zustand nie nur über Farbe: belegte Slots sind disabled und durchgestrichen.
    grid.innerHTML = slots
      .map((s) => {
        const time = fmtTime(s.start);
        if (!s.available) {
          return `<button type="button" disabled aria-disabled="true"
                    class="tnum min-h-[48px] cursor-not-allowed rounded-sm border border-line bg-[#252422] text-fg-muted line-through"
                    aria-label="${time} Uhr, belegt">${time}</button>`;
        }
        return `<button type="button" data-slot="${esc(s.start)}" aria-pressed="false"
                  class="tnum min-h-[48px] cursor-pointer rounded-sm border border-line-strong bg-surface text-fg transition-colors hover:bg-surface-2"
                  aria-label="${time} Uhr, frei">${time}</button>`;
      })
      .join('');
    grid.hidden = false;
  }

  $('[data-slots]').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-slot]');
    if (!btn) return;
    $$('[data-slot]').forEach((b) => {
      b.setAttribute('aria-pressed', 'false');
      b.className = 'tnum min-h-[48px] cursor-pointer rounded-sm border border-line-strong bg-surface text-fg transition-colors hover:bg-surface-2';
    });
    btn.setAttribute('aria-pressed', 'true');
    btn.className = 'tnum min-h-[48px] cursor-pointer rounded-sm border border-accent bg-accent font-semibold text-accent-on';
    state.slot = btn.dataset.slot;
    $('[data-next-3]').disabled = false;
  });

  $('[data-next-3]').addEventListener('click', () => {
    if (!state.slot) return;
    renderSummary();
    goTo(4);
  });

  function renderSummary() {
    $('[data-summary]').innerHTML = `
      <div class="flex justify-between gap-4"><dt class="text-fg-muted">Leistung</dt><dd class="text-right text-fg">${esc(state.service.name)}</dd></div>
      <div class="flex justify-between gap-4"><dt class="text-fg-muted">Bei</dt><dd class="text-right text-fg">${esc(state.employee.name)}</dd></div>
      <div class="flex justify-between gap-4"><dt class="text-fg-muted">Datum</dt><dd class="tnum text-right text-fg">${fmtDateLong(state.date)}</dd></div>
      <div class="flex justify-between gap-4"><dt class="text-fg-muted">Uhrzeit</dt><dd class="tnum text-right text-fg">${fmtTime(state.slot)} Uhr</dd></div>
      <div class="flex justify-between gap-4"><dt class="text-fg-muted">Dauer</dt><dd class="tnum text-right text-fg">${esc(state.service.durationMinutes)} Min.</dd></div>
      <div class="flex justify-between gap-4"><dt class="text-fg-muted">Preis</dt><dd class="tnum text-right font-semibold text-accent">${fmtPrice(state.service.priceCents)}</dd></div>`;
  }

  /* ---------------- Schritt 4: Absenden ---------------- */
  const form = $('[data-form]');

  function setFieldError(input, message) {
    const err = document.getElementById(`${input.id}-err`);
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      err.textContent = message;
      err.hidden = false;
    } else {
      input.removeAttribute('aria-invalid');
      err.textContent = '';
      err.hidden = true;
    }
  }

  function validate() {
    let firstInvalid = null;
    const name = $('#customer-name');
    const phone = $('#customer-phone');
    const email = $('#customer-email');

    setFieldError(name, name.value.trim().length >= 2 ? '' : 'Bitte gib deinen Namen an.');
    setFieldError(phone, phone.value.replace(/[\s()/-]/g, '').length >= 6 ? '' : 'Bitte gib eine erreichbare Telefonnummer an.');
    setFieldError(email, !email.value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())
      ? '' : 'Diese E-Mail-Adresse sieht nicht richtig aus.');

    for (const input of [name, phone, email]) {
      if (input.getAttribute('aria-invalid') === 'true') { firstInvalid = firstInvalid || input; }
    }
    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  // Erst bei blur prüfen, nicht bei jedem Tastendruck.
  ['#customer-name', '#customer-phone', '#customer-email'].forEach((sel) => {
    $(sel).addEventListener('blur', () => { if ($(sel).getAttribute('aria-invalid')) validate(); });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate()) return;

    const submit = $('[data-submit]');
    const label = $('[data-submit-label]');
    submit.disabled = true;                       // verhindert Doppel-Absenden
    label.textContent = 'Wird gebucht …';
    clearGlobalError();

    try {
      const payload = {
        serviceId: state.service.id,
        employeeId: state.employee.id,
        start: state.slot,
        customerName: $('#customer-name').value.trim(),
        customerPhone: $('#customer-phone').value.trim(),
        customerEmail: $('#customer-email').value.trim() || null,
        note: $('#customer-note').value.trim() || null,
      };
      const data = await window.BB.getJSON('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      state.booking = data?.booking || null;
      renderConfirmation();
      goTo(5);
    } catch (err) {
      if (err.status === 409) {
        /* Der Slot wurde in der Zwischenzeit vergeben — oder der Tag ist ein
           Feiertag/Schließtag. Eingaben bleiben erhalten, die Liste wird neu
           geladen und der Fokus wandert zu den Zeiten. */
        const message = err.body?.error === 'closed_day' && err.body.message
          ? err.body.message
          : 'Dieser Termin ist leider nicht mehr frei. Bitte wähle eine andere Uhrzeit.';
        state.slot = null;
        $('[data-next-3]').disabled = true;
        goTo(3);
        await loadSlots();
        $('[data-slots-live]').setAttribute('aria-live', 'assertive');
        $('[data-slots-live]').textContent = message;
        showGlobalError(message);
        $('[data-slots]').focus?.();
      } else {
        showGlobalError(
          'Die Buchung konnte nicht abgeschlossen werden. Bitte versuch es noch einmal oder ruf uns an: 0681 20397906.'
        );
      }
    } finally {
      submit.disabled = false;
      label.textContent = 'Termin verbindlich buchen';
    }
  });

  /* ---------------- Schritt 5: Bestätigung ---------------- */
  function renderConfirmation() {
    const b = state.booking;
    const start = b?.start || state.slot;
    $('[data-confirmation]').innerHTML = `
      <div class="flex justify-between gap-4"><dt class="text-fg-muted">Leistung</dt><dd class="text-right text-fg">${esc(state.service.name)}</dd></div>
      <div class="flex justify-between gap-4"><dt class="text-fg-muted">Bei</dt><dd class="text-right text-fg">${esc(state.employee.name)}</dd></div>
      <div class="flex justify-between gap-4"><dt class="text-fg-muted">Datum</dt><dd class="tnum text-right text-fg">${fmtDateLong(start.slice(0, 10))}</dd></div>
      <div class="flex justify-between gap-4"><dt class="text-fg-muted">Uhrzeit</dt><dd class="tnum text-right text-fg">${fmtTime(start)} Uhr</dd></div>
      ${b?.reference ? `<div class="flex justify-between gap-4"><dt class="text-fg-muted">Referenz</dt><dd class="tnum text-right text-fg">${esc(b.reference)}</dd></div>` : ''}`;
  }

  /* ---------------- Start ---------------- */
  goTo(1);
  loadServices();
})();
