/* Übersetzungen der Verwaltung — ausschließlich /admin.

   Die öffentliche Website ist nur deutsch und lädt diese Datei nie: sie liegt
   unter /assets/js/admin/ und wird nur von den Admin-Seiten importiert.

   Alle sichtbaren Texte stehen in i18n/de.js, i18n/ru.js und i18n/tr.js. Im Code
   steht nur der Schlüssel, nie der Text selbst und nie eine Sprachweiche.

   Sprache: gespeicherte Wahl (localStorage "admin_language") > Browsersprache
   (de/ru/tr) > Deutsch. Gespeichert wird nur eine Wahl, die jemand selbst trifft. */
import de from './i18n/de.js';
import ru from './i18n/ru.js';
import tr from './i18n/tr.js';

export const LANGUAGES = [
  { code: 'de', label: 'Deutsch', locale: 'de-AT' },
  { code: 'ru', label: 'Русский', locale: 'ru-RU' },
  { code: 'tr', label: 'Türkçe', locale: 'tr-TR' },
];

const DICTIONARIES = { de, ru, tr };
export const STORAGE_KEY = 'admin_language';
const FALLBACK = 'de';

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // privater Modus oder gesperrter Speicher: dann eben erkennen
  }
}

/** Erste unterstützte Sprache aus der Browser-Liste, sonst Deutsch. */
export function detectLanguage(list = navigator.languages?.length ? navigator.languages : [navigator.language]) {
  for (const tag of list) {
    const base = String(tag ?? '').toLowerCase().split(/[-_]/)[0];
    if (DICTIONARIES[base]) return base;
  }
  return FALLBACK;
}

let current = (() => {
  const stored = readStored();
  return DICTIONARIES[stored] ? stored : detectLanguage();
})();

export const getLanguage = () => current;
export const getLocale = () => LANGUAGES.find((l) => l.code === current).locale;

function lookup(dictionary, key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dictionary);
}

function interpolate(value, params) {
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, name) => (params[name] ?? match));
}

/** Gibt es diesen Schlüssel? (Alle drei Wörterbücher haben dieselben Schlüssel —
    scripts/test-admin-i18n.js prüft das.) */
export const has = (key) => lookup(DICTIONARIES[FALLBACK], key) !== undefined;

/** Text zum Schlüssel. Fehlt er in der aktiven Sprache, gilt Deutsch. */
export function t(key, params) {
  let value = lookup(DICTIONARIES[current], key);
  if (typeof value !== 'string') value = lookup(DICTIONARIES[FALLBACK], key);
  if (typeof value !== 'string') {
    console.warn(`[i18n] fehlender Schlüssel: ${key}`);
    return key;
  }
  return interpolate(value, params);
}

/** Mengenabhängiger Text; Pluralformen nach Intl.PluralRules (ru: one/few/many). */
export function tn(key, count, params = {}) {
  const forms = lookup(DICTIONARIES[current], key) ?? lookup(DICTIONARIES[FALLBACK], key);
  if (!forms || typeof forms !== 'object') {
    console.warn(`[i18n] fehlender Schlüssel: ${key}`);
    return key;
  }
  const rule = new Intl.PluralRules(getLocale()).select(count);
  const value = forms[rule] ?? forms.other;
  return interpolate(value, { count, ...params });
}

/**
 * Statische Texte im Markup übersetzen:
 *   data-i18n="nav.bookings"                  -> textContent
 *   data-i18n-attr="placeholder:x.y;aria-label:x.z" -> Attribute
 */
export function applyTranslations(root = document) {
  document.documentElement.lang = current;
  root.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((node) => {
    for (const pair of node.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((part) => part.trim());
      if (attr && key) node.setAttribute(attr, t(key));
    }
  });
}

/** Sprache wechseln: speichern, Markup neu beschriften, Seiten neu zeichnen lassen. */
export function setLanguage(code) {
  if (!DICTIONARIES[code] || code === current) return;
  current = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Nicht speicherbar — die Wahl gilt dann nur für diese Seite.
  }
  applyTranslations(document);
  window.dispatchEvent(new CustomEvent('admin:language', { detail: { language: code } }));
}

export function onLanguageChange(handler) {
  window.addEventListener('admin:language', handler);
}

applyTranslations(document);
