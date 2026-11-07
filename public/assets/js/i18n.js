/* Sprachen der öffentlichen Website: Deutsch (Quelltext) und Englisch.

   Das HTML bleibt deutsch. Ist Englisch aktiv, ersetzt dieses Skript beim
   Laden die deutschen Texte anhand des Wörterbuchs unten (Schlüssel = deutscher
   Text mit normalisierten Leerzeichen). Elemente mit gemischtem Inhalt oder
   mehrdeutigem Text tragen ihre englische Fassung direkt im Attribut data-en
   (innerHTML). Von JavaScript erzeugte Texte laufen über I18N.t().

   Sprache: gespeicherte Wahl (localStorage "site_language") > erste Sprache
   des Browsers: Deutsch -> de, alles andere -> en. Der Umschalter speichert
   die Wahl und lädt die Seite neu.

   Muss synchron im <head> stehen — vor site.js und den Seitenskripten. */
(() => {
  'use strict';

  const STORAGE_KEY = 'site_language';
  const SUPPORTED = ['de', 'en'];

  function stored() {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  }
  function detect() {
    const first = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    return first.toLowerCase().startsWith('de') ? 'de' : 'en';
  }

  const lang = SUPPORTED.includes(stored()) ? stored() : detect();
  const locale = lang === 'de' ? 'de-AT' : 'en-GB';
  document.documentElement.lang = lang;

  /* ------------------------------------------------------------ Wörterbuch */
  const EN = {
    // Allgemein / Navigation
    'Zum Inhalt springen': 'Skip to content',
    'Zurzeit sind keine Leistungen online buchbar. Bitte ruf uns kurz an:': 'No services can be booked online right now. Please give us a call:',
    'Für diese Leistung ist zurzeit niemand online buchbar. Bitte ruf uns an:': 'Nobody can be booked online for this service right now. Please call us:',
    '. Bitte melde dich telefonisch, wenn du den Termin nicht wahrnehmen kannst.': '. Please call us if you can\'t make it.',
    'Hauptnavigation': 'Main navigation',
    'Mobile Navigation': 'Mobile navigation',
    'Start': 'Home',
    'Über uns': 'About us',
    'Preise': 'Prices',
    'Zeiten': 'Hours',
    'Kontakt': 'Contact',
    'Galerie': 'Gallery',
    'Termin buchen': 'Book now',
    'Menü öffnen': 'Open menu',
    'Menü schließen': 'Close menu',
    'Öffnungszeiten': 'Opening hours',
    'Seiten': 'Pages',
    '· Österreich': '· Austria',
    'Old-School Barbier-Handwerk in Bregenz.': 'Old-school barbering in Bregenz.',
    'Sprache': 'Language',

    // Startseite
    'Bregenz Barbershop – Friseur & Barbier in Bregenz | Jahnstraße 9': 'Bregenz Barbershop – Barber in Bregenz | Jahnstraße 9',
    'Old-School Barbier-Handwerk in Bregenz: Herren-Haarschnitt, Bartpflege und Konturen mit dem Messer. Jahnstraße 9, 6900 Bregenz. Jetzt online Termin buchen.':
      'Old-school barbering in Bregenz: men\'s haircuts, beard care and razor line-ups. Jahnstraße 9, 6900 Bregenz. Book your appointment online.',
    'Bregenz Barbershop – Friseur & Barbier in Bregenz': 'Bregenz Barbershop – Barber in Bregenz',
    'Präzise Haarschnitte, saubere Konturen und klassische Bartpflege – mitten in Bregenz. Jetzt online Termin buchen.':
      'Precise haircuts, clean line-ups and classic beard care in the heart of Bregenz. Book online now.',
    'Dein Schnitt.': 'Your cut.',
    'Dein Stil.': 'Your style.',
    'Präzise Haarschnitte, saubere Konturen und klassische Bartpflege — Old-School Handwerk mitten in Bregenz.':
      'Precise haircuts, clean line-ups and classic beard care — old-school craft in the heart of Bregenz.',
    'Unser Team': 'Our team',
    'Vorherige Person': 'Previous person',
    'Nächste Person': 'Next person',
    'Preisliste': 'Price list',
    'Preise & Leistungen': 'Prices & Services',
    'Alle Preise in Euro, inklusive Beratung. Termine gerne online — Laufkundschaft ist willkommen, kann aber warten müssen.':
      'All prices in euros, consultation included. Book online — walk-ins are welcome but may have to wait.',
    'Was Kunden sagen': 'What clients say',
    'Bewertungen': 'Reviews',
    'von 5 ·': 'out of 5 ·',
    'Google-Bewertungen': 'Google reviews',
    'Alle Bewertungen bei Google': 'All reviews on Google',
    'Wann wir da sind': 'When we\'re open',
    'Ohne Termin kann es voll werden — online buchen geht schneller.': 'Without an appointment it can get busy — booking online is faster.',
    'So findest du uns': 'How to find us',
    'Gesprochen wird Deutsch, Englisch, Arabisch und Türkisch.': 'We speak German, English, Arabic and Turkish.',
    'Die Karte wird von Google Maps geladen. Dabei werden Daten an Google übertragen.':
      'The map is loaded from Google Maps, which sends data to Google.',
    'Karte laden': 'Load map',
    'Stattdessen in Google Maps öffnen': 'Open in Google Maps instead',
    'Bereit?': 'Ready?',
    'Jetzt Termin sichern': 'Book your chair now',

    // Galerie
    'Galerie – Bregenz Barbershop': 'Gallery – Bregenz Barbershop',
    'Arbeiten aus dem Bregenz Barbershop: Haarschnitte, Fades, Bartpflege und Konturen. Bilder aus dem Salon.':
      'Work from Bregenz Barbershop: haircuts, fades, beard care and line-ups. Pictures from the salon.',
    'Unsere Arbeit': 'Our work',
    'Schnitte, Fades und Bartarbeit aus dem Salon.': 'Cuts, fades and beard work from the salon.',
    'Noch keine Bilder in der Galerie.': 'No pictures in the gallery yet.',
    'Schau bald wieder vorbei.': 'Check back soon.',
    'Zu unserem Instagram': 'Visit our Instagram',
    'Preise ansehen': 'See prices',
    'Galerie schließen': 'Close gallery',
    'Vorheriges Bild': 'Previous image',
    'Nächstes Bild': 'Next image',
    'Auf Instagram': 'On Instagram',
    'Arbeit aus dem Bregenz Barbershop': 'Work from Bregenz Barbershop',
    'Bild {n} von {total} vergrößern': 'Enlarge image {n} of {total}',

    // Buchung
    'Termin buchen – Bregenz Barbershop': 'Book an appointment – Bregenz Barbershop',
    'Online einen Termin im Bregenz Barbershop buchen: Leistung wählen, freie Zeit aussuchen, fertig.':
      'Book an appointment at Bregenz Barbershop online: choose a service, pick a free time, done.',
    'Zurück zur Website': 'Back to website',
    'Schritt': 'Step',
    'von': 'of',
    'Leistung': 'Service',
    'Mitarbeiter': 'Barber',
    'Termin': 'Time',
    'Ihre Daten': 'Your details',
    'Bestätigung': 'Confirmation',
    'Erneut versuchen': 'Try again',
    'Welche Leistung?': 'Which service?',
    'Bei wem?': 'With whom?',
    'Zurück': 'Back',
    'Weiter': 'Next',
    'Wann passt es dir?': 'When suits you?',
    'Datum': 'Date',
    'Alle Zeiten in der Zeitzone Europe/Vienna.': 'All times are in the Europe/Vienna time zone.',
    'Freie Zeiten': 'Available times',
    'Verfügbare Uhrzeiten': 'Available times',
    'An diesem Tag sind keine Termine mehr frei.': 'No free slots left on this day.',
    'Deine Daten': 'Your details',
    'Name': 'Name',
    'Telefonnummer': 'Phone number',
    'Für Rückfragen, falls etwas dazwischenkommt.': 'So we can reach you if something comes up.',
    'E-Mail': 'Email',
    'Optional — für die Terminbestätigung.': 'Optional — for the booking confirmation.',
    'Anmerkung': 'Note',
    'Optional.': 'Optional.',
    'Zusammenfassung': 'Summary',
    'Termin verbindlich buchen': 'Confirm booking',
    'Wird gebucht …': 'Booking …',
    'Termin bestätigt': 'Booking confirmed',
    'Bis bald im Salon!': 'See you soon at the salon!',
    'Zur Startseite': 'Back to home',
    'Bei': 'With',
    'Uhrzeit': 'Time',
    'Dauer': 'Duration',
    'Preis': 'Price',
    'Referenz': 'Reference',
    '{time} Uhr': '{time}',
    '{time} Uhr, belegt': '{time}, taken',
    '{time} Uhr, frei': '{time}, available',
    '{n} freie Zeiten gefunden.': '{n} available times found.',
    'Am {date} ist der Salon geschlossen ({name}). An diesem Tag sind keine Termine möglich.':
      'The salon is closed on {date} ({name}). No appointments are possible on this day.',
    'An diesem Tag hat der Salon geschlossen.': 'The salon is closed on this day.',
    'Der nächste freie Tag ist {date}.': 'The next available day is {date}.',
    'Bitte gib deinen Namen an.': 'Please enter your name.',
    'Bitte gib eine erreichbare Telefonnummer an.': 'Please enter a phone number we can reach you on.',
    'Diese E-Mail-Adresse sieht nicht richtig aus.': 'This email address doesn\'t look right.',
    'Dieser Termin ist leider nicht mehr frei. Bitte wähle eine andere Uhrzeit.':
      'Sorry, this time has just been taken. Please choose another time.',
    'Die Terminverfügbarkeit ist gerade nicht abrufbar. Bitte versuch es in einem Moment noch einmal oder ruf uns an.':
      'Availability can\'t be loaded right now. Please try again in a moment or give us a call.',
    'Die Buchung konnte nicht abgeschlossen werden. Bitte versuch es noch einmal oder ruf uns an.':
      'The booking could not be completed. Please try again or give us a call.',

    // Startseite, aus JavaScript
    'geschlossen': 'closed',
    'Geschlossen': 'Closed',
    'Jetzt geöffnet': 'Open now',
    'Gerade geschlossen': 'Closed right now',
    'Heute geschlossen – {name}': 'Closed today – {name}',
    '{n} Min.': '{n} min',
    'Aktuell sind keine Leistungen online buchbar. Ruf uns gerne an.': 'No services can be booked online at the moment. Feel free to call us.',
    'Angebote': 'Offers',
    'Leistungen': 'Services',
    'Sprachen': 'Languages',
    'Im Salon': 'In the salon',
    '{n} Tag': '{n} day',
    '{n} Tage': '{n} days',
    'Erfahrung': 'Experience',
    '{n} Jahr': '{n} year',
    '{n} Jahre': '{n} years',
    '{i} von {total}: {name}': '{i} of {total}: {name}',
    '{name} anzeigen': 'Show {name}',
    'Karte: {address}': 'Map: {address}',
    'Diese Angaben konnten gerade nicht geladen werden. Bitte lade die Seite neu.':
      'This information could not be loaded. Please reload the page.',
    '{rating} von 5 Sternen': '{rating} out of 5 stars',
  };

  const DAYS = {
    de: { long: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
      short: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] },
    en: { long: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      short: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] },
  };

  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

  /** Text in der aktiven Sprache; Schlüssel ist der deutsche Text. */
  function t(german, params) {
    let value = lang === 'en' ? (EN[german] ?? german) : german;
    if (params) value = value.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m));
    return value;
  }

  /** Preis wie auf der Kundenseite: "25,00 €" (de) bzw. "€25.00" (en). */
  function price(cents) {
    if (lang === 'en') {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(cents / 100);
    }
    const n = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
    return `${n} €`;
  }

  /* --------------------------------------------- Statisches Markup übersetzen */
  const ATTRS = ['aria-label', 'alt', 'title', 'placeholder'];

  function translateDocument() {
    if (lang !== 'en') return;
    const title = norm(document.title);
    if (EN[title]) document.title = EN[title];
    document.querySelectorAll('meta[name="description"], meta[property="og:title"], meta[property="og:description"]').forEach((m) => {
      const key = norm(m.content);
      if (EN[key]) m.content = EN[key];
    });
    const ogLocale = document.querySelector('meta[property="og:locale"]');
    if (ogLocale) ogLocale.content = 'en_GB';

    document.querySelectorAll('[data-en]').forEach((el) => { el.innerHTML = el.dataset.en; });

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement?.closest('script, style, [data-en], [data-no-i18n]')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const key = norm(node.nodeValue);
      if (!key || !EN[key]) continue;
      const lead = /^\s/.test(node.nodeValue) ? ' ' : '';
      const trail = /\s$/.test(node.nodeValue) ? ' ' : '';
      node.nodeValue = lead + EN[key] + trail;
    }
    document.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(',')).forEach((el) => {
      for (const attr of ATTRS) {
        const value = el.getAttribute(attr);
        if (value && EN[norm(value)]) el.setAttribute(attr, EN[norm(value)]);
      }
    });
  }

  /* ------------------------------------------------------------- Umschalter */
  function setLanguage(code) {
    if (!SUPPORTED.includes(code)) return;
    try {
      localStorage.setItem(STORAGE_KEY, code);
      // Die Verwaltung soll in derselben Sprache aufgehen, solange dort nichts
      // anderes gewählt wurde.
      localStorage.setItem('admin_language', code);
    } catch { /* nicht speicherbar: gilt nur für diesen Aufruf */ }
    if (code !== lang) location.reload();
  }

  function renderSwitches() {
    document.querySelectorAll('[data-lang-switch]').forEach((box) => {
      box.classList.add('lang-switch');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', lang === 'en' ? 'Language' : 'Sprache');
      box.innerHTML = SUPPORTED.map((code) => `<button type="button" data-lang="${code}" lang="${code}"
          aria-pressed="${code === lang}" title="${code === 'de' ? 'Deutsch' : 'English'}">${code.toUpperCase()}</button>`).join('');
      box.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-lang]');
        if (btn) setLanguage(btn.dataset.lang);
      });
    });
  }

  /* Englisch: bis die Texte ersetzt sind, bleibt die Seite unsichtbar — sonst
     blitzt beim Laden kurz das deutsche Original auf. */
  if (lang === 'en') {
    document.documentElement.classList.add('i18n-pending');
    const style = document.createElement('style');
    style.textContent = '.i18n-pending body{visibility:hidden}';
    document.head.appendChild(style);
    setTimeout(() => document.documentElement.classList.remove('i18n-pending'), 1500);
  }

  document.addEventListener('DOMContentLoaded', () => {
    translateDocument();
    renderSwitches();
    document.documentElement.classList.remove('i18n-pending');
  });

  window.I18N = { lang, locale, t, price, days: DAYS[lang], setLanguage };
})();
