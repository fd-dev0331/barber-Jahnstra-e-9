/* Seitenhülle der Verwaltung: Kopfzeile (Betrieb, Person, Rolle, Sprache,
   Abmelden), Seitenleiste ab 1024px, Menü als Bottom-Sheet darunter.

   Die Sprachwahl sitzt direkt in der Kopfzeile und bleibt auf jeder Breite
   sichtbar — auch bei 320px, nie nur im Menü. */
import { t, getLanguage, setLanguage, LANGUAGES, onLanguageChange } from './i18n.js';
import {
  api, ApiError, session, setTimezone, hasRank, roleLabel, escapeHtml, redirectToLogin,
} from './core.js';
import { icon, handleError } from './ui.js';
import { initTelegram, isMiniApp, clearToken } from './telegram.js';

/* Welche Rolle eine Seite mindestens braucht. Nur Anzeige — das Backend prüft
   jeden Endpunkt selbst (api/admin/[...path].js). */
export const PAGES = [
  { id: 'dashboard', href: '/admin', role: 'EMPLOYEE', icon: 'dashboard' },
  { id: 'bookings', href: '/admin/bookings', role: 'EMPLOYEE', icon: 'list' },
  { id: 'calendar', href: '/admin/calendar', role: 'EMPLOYEE', icon: 'calendar' },
  { id: 'employees', href: '/admin/employees', role: 'ADMIN', icon: 'users' },
  { id: 'services', href: '/admin/services', role: 'ADMIN', icon: 'scissors' },
  { id: 'gallery', href: '/admin/gallery', role: 'ADMIN', icon: 'image' },
  { id: 'business', href: '/admin/business', role: 'ADMIN', icon: 'store' },
  { id: 'google', href: '/admin/google', role: 'ADMIN', icon: 'calendarCheck' },
  { id: 'settings', href: '/admin/settings', role: 'EMPLOYEE', icon: 'settings' },
];

/* ------------------------------------------------------------ Sprachwahl */

export function languageSwitcher() {
  const current = getLanguage();
  const currentLabel = LANGUAGES.find((l) => l.code === current).label;
  const options = LANGUAGES.map((l) => `
    <button type="button" class="adm-lang-option" role="menuitemradio" aria-checked="${l.code === current}"
      data-lang-option="${l.code}" lang="${l.code}">
      <span class="adm-lang-code">${l.code.toUpperCase()}</span>
      <span class="min-w-0 flex-1">${escapeHtml(l.label)}</span>
      ${l.code === current ? icon('check') : ''}
    </button>`).join('');

  return `<div class="adm-lang">
    <button type="button" class="adm-lang-button" data-lang-toggle aria-haspopup="menu" aria-expanded="false"
      aria-label="${escapeHtml(t('shell.languageCurrent', { language: currentLabel }))}">
      <span class="hidden sm:inline-flex">${icon('globe')}</span>
      <span>${current.toUpperCase()}</span>
      ${icon('chevronDown')}
    </button>
    <div class="adm-lang-menu" role="menu" aria-label="${escapeHtml(t('shell.language'))}" hidden>${options}</div>
  </div>`;
}

function closeLanguageMenus() {
  document.querySelectorAll('.adm-lang-menu').forEach((menu) => {
    menu.hidden = true;
    menu.parentElement.querySelector('[data-lang-toggle]')?.setAttribute('aria-expanded', 'false');
  });
}

function openLanguageMenu(toggle) {
  const menu = toggle.parentElement.querySelector('.adm-lang-menu');
  menu.hidden = false;
  toggle.setAttribute('aria-expanded', 'true');
  (menu.querySelector('[aria-checked="true"]') ?? menu.querySelector('[data-lang-option]'))?.focus();
}

/* Delegiert am Dokument: die Kopfzeile wird beim Sprachwechsel neu gezeichnet,
   die Ereignisse müssen das überleben. */
let languageEventsBound = false;
export function bindLanguageEvents() {
  if (languageEventsBound) return;
  languageEventsBound = true;

  document.addEventListener('click', (event) => {
    const option = event.target.closest('[data-lang-option]');
    if (option) {
      closeLanguageMenus();
      setLanguage(option.dataset.langOption);
      document.querySelector('[data-lang-toggle]')?.focus();
      return;
    }
    const toggle = event.target.closest('[data-lang-toggle]');
    if (toggle) {
      const wasOpen = toggle.getAttribute('aria-expanded') === 'true';
      closeLanguageMenus();
      if (!wasOpen) openLanguageMenu(toggle);
      return;
    }
    if (!event.target.closest('.adm-lang-menu')) closeLanguageMenus();
  });

  document.addEventListener('keydown', (event) => {
    const menu = document.querySelector('.adm-lang-menu:not([hidden])');
    if (!menu) return;
    const options = [...menu.querySelectorAll('[data-lang-option]')];
    const index = options.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      const toggle = menu.parentElement.querySelector('[data-lang-toggle]');
      closeLanguageMenus();
      toggle?.focus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      options[(index + 1) % options.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      options[(index - 1 + options.length) % options.length].focus();
    } else if (event.key === 'Tab') {
      closeLanguageMenus();
    }
  });
}

/* ----------------------------------------------------------------- Hülle */

let menuDialog = null;

function navLinks(active) {
  return PAGES
    .filter((page) => hasRank(session.user, page.role))
    .map((page) => `<a class="adm-nav-link" href="${page.href}" ${page.id === active ? 'aria-current="page"' : ''}>
        ${icon(page.icon)}<span class="min-w-0 truncate">${escapeHtml(t(`nav.${page.id}`))}</span></a>`)
    .join('');
}

function renderShell(active) {
  const { user, business } = session;
  const businessName = business?.name || t('shell.brandFallback');
  const role = escapeHtml(roleLabel(user.role));

  document.title = `${t(`nav.${active}`)} – ${businessName}`;

  const header = document.querySelector('[data-app-header]');
  header.innerHTML = `<div class="adm-header-inner">
    <a class="adm-brand" href="/admin">
      <span class="adm-brand-mark" aria-hidden="true">${icon('scissors')}</span>
      <span class="adm-brand-text">
        <span class="adm-brand-name">${escapeHtml(businessName)}</span>
        <span class="adm-brand-sub">${escapeHtml(t('shell.adminArea'))}</span>
      </span>
    </a>
    <div class="adm-user md:flex">
      <span class="adm-user-name">${escapeHtml(user.name)}</span>
      <span class="adm-badge st-gold">${role}</span>
    </div>
    ${languageSwitcher()}
    ${isMiniApp() ? '' : `<button type="button" class="adm-btn-ghost adm-btn-sm hidden lg:inline-flex" data-logout>
      ${icon('logout')}<span>${escapeHtml(t('shell.logout'))}</span>
    </button>`}
    <button type="button" class="adm-icon-btn lg:hidden" data-menu-open aria-haspopup="dialog" aria-controls="adm-menu"
      aria-label="${escapeHtml(t('shell.openMenu'))}">${icon('menu')}</button>
  </div>`;

  const sidebar = document.querySelector('[data-app-sidebar]');
  sidebar.innerHTML = `<nav class="adm-nav" aria-label="${escapeHtml(t('shell.navigation'))}">${navLinks(active)}</nav>`;

  if (!menuDialog) {
    menuDialog = document.createElement('dialog');
    menuDialog.id = 'adm-menu';
    menuDialog.className = 'adm-sheet';
    document.body.append(menuDialog);
  }
  menuDialog.setAttribute('aria-label', t('shell.menu'));
  menuDialog.innerHTML = `
    <div class="flex items-center justify-between gap-3 border-b border-line py-2 pl-4 pr-2">
      <div class="min-w-0 py-1">
        <p class="truncate text-sm font-semibold text-fg">${escapeHtml(user.name)}</p>
        <p class="mt-1"><span class="adm-badge st-gold">${role}</span></p>
      </div>
      <button type="button" class="adm-icon-btn adm-icon-btn-plain" data-menu-close aria-label="${escapeHtml(t('common.close'))}">${icon('close')}</button>
    </div>
    <nav class="adm-nav min-h-0 overflow-y-auto p-2" aria-label="${escapeHtml(t('shell.navigation'))}">${navLinks(active)}</nav>
    ${isMiniApp() ? '' : `<div class="border-t border-line p-3">
      <button type="button" class="adm-btn-ghost adm-btn-block" data-logout>${icon('logout')}<span>${escapeHtml(t('shell.logout'))}</span></button>
    </div>`}`;
}

async function logout(button) {
  button.disabled = true;
  try {
    await api('/session', { method: 'DELETE' });
    clearToken();
  } catch {
    // Auch ohne Antwort zurück zur Anmeldung; die Session läuft serverseitig ab.
  }
  window.location.href = '/admin';
}

let shellEventsBound = false;
function bindShellEvents() {
  if (shellEventsBound) return;
  shellEventsBound = true;
  bindLanguageEvents();

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-menu-open]')) {
      menuDialog?.showModal();
      return;
    }
    if (menuDialog?.open && (event.target.closest('[data-menu-close]') || event.target === menuDialog)) {
      menuDialog.close();
      return;
    }
    const logoutButton = event.target.closest('[data-logout]');
    if (logoutButton) logout(logoutButton);
  });

  // Ab 1024px gibt es die Seitenleiste; ein offenes Menü wäre dann doppelt.
  const desktop = window.matchMedia('(min-width: 1024px)');
  const closeOnDesktop = (event) => {
    if (event.matches && menuDialog?.open) menuDialog.close();
  };
  // Safari < 14 kennt an MediaQueryList nur addListener.
  if (desktop.addEventListener) desktop.addEventListener('change', closeOnDesktop);
  else desktop.addListener(closeOnDesktop);
}

let activePage = null;

/** Kopfzeile neu zeichnen, z. B. nachdem der Betriebsname geändert wurde. */
export function refreshShell() {
  if (activePage && session.user) renderShell(activePage);
}

export function showBootError() {
  document.querySelector('[data-boot]')?.setAttribute('hidden', '');
  document.querySelector('[data-boot-error]')?.removeAttribute('hidden');
}

/**
 * Session prüfen und die Seitenhülle aufbauen. Ohne gültige Session geht es
 * zurück auf /admin — die Seite rendert nie Daten, die sie nicht vom Server hat.
 * `preloaded` erspart /admin einen zweiten Aufruf von GET /session.
 */
export async function requireSession(active, preloaded = null) {
  /* Zuerst der Rahmen: erst danach weiß core.js, dass es in Telegram läuft und
     eine abgelaufene Sitzung dort selbst erneuern darf. */
  await initTelegram();
  bindShellEvents();

  let data = preloaded;
  if (!data) {
    try {
      data = await api('/session');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        redirectToLogin();
        return null;
      }
      showBootError();
      handleError(err);
      return null;
    }
  }

  session.user = data.user;
  session.business = data.business ?? null;
  session.employee = data.employee ?? null;
  setTimezone(data.business?.timezone);
  document.documentElement.dataset.role = data.user.role;

  // Seiten, die diese Rolle ohnehin nicht nutzen darf, gar nicht erst zeigen.
  const page = PAGES.find((entry) => entry.id === active);
  if (page && !hasRank(data.user, page.role)) {
    window.location.replace('/admin');
    return null;
  }

  activePage = active;
  renderShell(active);
  onLanguageChange(() => renderShell(active));

  document.querySelectorAll('[data-shell]').forEach((node) => { node.hidden = false; });
  document.querySelector('[data-boot]')?.setAttribute('hidden', '');
  return data.user;
}
