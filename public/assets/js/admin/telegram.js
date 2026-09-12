/* Die Verwaltung als Telegram Mini App.

   Dieselben Seiten, derselbe Server — nur der Rahmen ist ein anderer. Diese
   Datei ist die gesamte Telegram-Besonderheit des Frontends:

     · erkennt, ob die Seite in Telegram läuft, und lädt nur dann das SDK
       (im normalen Browser wird kein fremdes Skript geladen);
     · meldet sich mit dem signierten `initData` an und hält das Sitzungstoken;
     · passt den Rahmen an: volle Höhe, Farben, Zurück-Knopf von Telegram.

   Das Token kommt vom Server und wird als Bearer-Header geschickt, weil ein
   Cookie im Telegram-iframe nicht ankommen würde (lib/auth.js). Es liegt im
   sessionStorage: beim Schließen der Mini App ist es weg, beim nächsten Start
   entsteht aus `initData` lautlos ein neues.

   Diese Datei importiert bewusst nichts aus core.js oder i18n.js — i18n.js
   fragt hier die Telegram-Sprache ab, und ein Kreis wäre die Folge. */

const SDK_URL = 'https://telegram.org/js/telegram-web-app.js';
const TOKEN_KEY = 'admin_tg_token';
const FLAG_KEY = 'admin_tg';
/* Diesen Schlüssel legt das Telegram-SDK selbst an; er überlebt den Wechsel
   zwischen den Admin-Seiten und verrät uns, dass wir in Telegram sind. */
const SDK_PARAMS_KEY = '__telegram__initParams';

const store = {
  get(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Privater Modus: die Sitzung gilt dann nur für diese Seite.
    }
  },
  remove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // s. o.
    }
  },
};

/* ------------------------------------------------------- Erkennung, Sprache */

/** `initData` aus der Adresse oder aus dem, was das SDK hinterlegt hat. */
function rawInitData() {
  const fromHash = new URLSearchParams((window.location?.hash ?? '').replace(/^#/, '')).get('tgWebAppData');
  if (fromHash) return fromHash;
  try {
    const stored = JSON.parse(store.get(SDK_PARAMS_KEY) ?? 'null');
    return stored?.tgWebAppData ?? null;
  } catch {
    return null;
  }
}

/** Läuft diese Seite in Telegram? Ohne SDK, damit i18n.js sofort antworten kann. */
export function looksLikeTelegram() {
  if (store.get(FLAG_KEY) === '1') return true;
  const address = `${window.location?.hash ?? ''}${window.location?.search ?? ''}`;
  return address.includes('tgWebApp') || rawInitData() !== null;
}

/**
 * Sprache des Telegram-Kontos (de/ru/tr …) oder null.
 * Sie zählt beim ersten Start als Vorschlag — eine eigene Wahl in der
 * Verwaltung bleibt immer stärker (i18n.js).
 */
export function telegramLanguageHint() {
  const data = rawInitData();
  if (!data) return null;
  try {
    const user = JSON.parse(new URLSearchParams(data).get('user') ?? 'null');
    return user?.language_code ?? null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ Rahmen */

let webApp = null;
let ready = null;

export const isMiniApp = () => webApp !== null;
export const getWebApp = () => webApp;

function loadSdk() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('telegram_sdk'));
    document.head.append(script);
  });
}

function applyChrome() {
  document.documentElement.dataset.tg = '1';
  // Telegram zeigt eine eigene Kopfzeile; sie soll dieselbe Farbe haben wie unsere.
  try {
    webApp.setHeaderColor('#1A1816');
    webApp.setBackgroundColor('#0E0D0C');
  } catch {
    // Ältere Telegram-Versionen können das nicht — kosmetisch, nicht kritisch.
  }
  try {
    webApp.expand();
  } catch {
    // s. o.
  }
  /* Ohne das schließt eine Wischgeste nach unten die App mitten im Formular. */
  try {
    webApp.disableVerticalSwipes?.();
  } catch {
    // s. o.
  }

  const setHeight = () => {
    const height = webApp.viewportStableHeight || webApp.viewportHeight;
    if (height) document.documentElement.style.setProperty('--tg-viewport', `${height}px`);
  };
  setHeight();
  webApp.onEvent?.('viewportChanged', setHeight);
}

/* Telegram blendet einen eigenen Zurück-Knopf ein. In der Verwaltung führt er
   dahin, wo der Browser auch hinführen würde — sonst zurück aufs Dashboard. */
function setupBackButton() {
  const back = webApp.BackButton;
  if (!back) return;
  const onDashboard = window.location.pathname.replace(/\/+$/, '') === '/admin';
  try {
    back.onClick(() => {
      if (window.history.length > 1) window.history.back();
      else window.location.href = '/admin';
    });
    // Ältere Telegram-Versionen kennen den Knopf nicht; dann bleibt es beim
    // Zurück des Geräts — deshalb ist das hier kein Grund zum Abbrechen.
    if (onDashboard) back.hide();
    else back.show();
  } catch {
    // s. o.
  }
}

/**
 * Telegram-Rahmen vorbereiten. Gibt zurück, ob die Seite wirklich in Telegram
 * läuft; im normalen Browser passiert hier gar nichts.
 */
export function initTelegram() {
  if (ready) return ready;
  ready = (async () => {
    if (!looksLikeTelegram()) return false;
    try {
      if (!window.Telegram?.WebApp) await loadSdk();
    } catch {
      // SDK nicht erreichbar: dann eben als normale Website weiter.
      return false;
    }
    const app = window.Telegram?.WebApp;
    // Ohne initData ist das kein echter Mini-App-Start (z. B. Adresse kopiert).
    if (!app || !app.initData) return false;

    webApp = app;
    store.set(FLAG_KEY, '1');
    try {
      webApp.ready();
    } catch {
      // s. o.
    }
    applyChrome();
    setupBackButton();
    return true;
  })();
  return ready;
}

/** Kurze Rückmeldung im Gerät — nur wenn Telegram sie unterstützt. */
export function haptic(type = 'light') {
  try {
    if (type === 'success' || type === 'error' || type === 'warning') {
      webApp?.HapticFeedback?.notificationOccurred(type);
    } else {
      webApp?.HapticFeedback?.impactOccurred(type);
    }
  } catch {
    // Kein Haptik-Motor oder alte Version.
  }
}

/* --------------------------------------------------------------- Anmeldung */

export const authToken = () => (webApp ? store.get(TOKEN_KEY) : null);
export const clearToken = () => store.remove(TOKEN_KEY);

async function post(path, body) {
  const response = await fetch(`/api/admin${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

/**
 * Anmeldung mit dem signierten Telegram-Start.
 * Ergebnis:
 *   { ok: true, data }            angemeldet, data ist die Sitzungsantwort
 *   { ok: false, needsLink: true } Telegram-Konto noch nicht verknüpft
 *   { ok: false, error }           alles andere (abgelaufen, gesperrt, Serverfehler)
 */
export async function signIn() {
  if (!webApp?.initData) return { ok: false, error: 'telegram_invalid' };
  const { status, payload } = await post('/session/telegram', { initData: webApp.initData });
  if (status === 200 && payload.token) {
    store.set(TOKEN_KEY, payload.token);
    return { ok: true, data: payload };
  }
  clearToken();
  if (status === 403 && payload.error === 'telegram_not_linked') {
    return { ok: false, needsLink: true };
  }
  return { ok: false, error: payload.error ?? 'error', message: payload.message };
}

/** Einmalige Verknüpfung: dieselben Zugangsdaten wie im Browser. */
export async function linkAccount({ email, password }) {
  if (!webApp?.initData) return { ok: false, error: 'telegram_invalid' };
  const { status, payload } = await post('/session/telegram/link', {
    initData: webApp.initData, email, password,
  });
  if (status === 201 && payload.token) {
    store.set(TOKEN_KEY, payload.token);
    return { ok: true, data: payload };
  }
  return { ok: false, error: payload.error ?? 'error', message: payload.message, status };
}

/**
 * Abgelaufenes Token ersetzen. Aufgerufen von core.js, wenn ein Aufruf mit 401
 * antwortet: in Telegram lässt sich die Sitzung ohne Zutun erneuern.
 */
export async function reauthenticate() {
  if (!webApp) return false;
  const result = await signIn();
  return result.ok === true;
}

/** Telegram-Person, wie sie sich selbst nennt — nur zur Anzeige. */
export function telegramUser() {
  const user = webApp?.initDataUnsafe?.user;
  if (!user) return null;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return {
    id: user.id,
    name: name || (user.username ? `@${user.username}` : ''),
    username: user.username ?? null,
  };
}
