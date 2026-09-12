/* End-to-End-Test der Telegram-Anbindung gegen den laufenden Dev-Server.

   Aufruf:  TELEGRAM_BOT_TOKEN=<test-token> npm run dev   (zweites Terminal)
            TELEGRAM_BOT_TOKEN=<test-token> node scripts/test-telegram.js

   Derselbe Token muss in beiden Prozessen stehen: der Test unterschreibt
   `initData` genau so, wie Telegram es täte, und der Server rechnet die
   Signatur mit seinem Token nach. Ein erfundener Token reicht dafür völlig —
   es wird nie mit Telegram gesprochen.

   Geprüft wird der ganze Weg: gefälschte Signatur, altes auth_date, nicht
   verknüpftes Konto, Verknüpfung mit falschem und richtigem Passwort,
   Bearer-Sitzung ohne CSRF-Token, Rechte und Lösen der Verknüpfung.
   Am Ende bleibt keine Verknüpfung zurück. */
import crypto from 'node:crypto';
import { loadEnv } from './env.js';

loadEnv();

const BASE = process.env.BASE || 'http://localhost:3210';
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
const OWNER_EMAIL = process.env.ADMIN_TEST_EMAIL || 'abo@example.com';
const OWNER_PASSWORD = process.env.ADMIN_TEST_PASSWORD || 'barbier-2026!';
/* Zufällige Telegram-ID: der Test soll sich nicht an einer echten Verknüpfung
   vergreifen und bei mehrfachem Lauf nichts übrig lassen. */
const TELEGRAM_ID = 900_000_000 + Math.floor(Math.random() * 50_000_000);

let pass = 0, fail = 0;

function check(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label} ${detail}`); }
}

/** `initData` bauen und unterschreiben — derselbe Weg wie in lib/telegram.js. */
function initData({
  id = TELEGRAM_ID, authDate = Math.floor(Date.now() / 1000), token = TOKEN, broken = false, signature = null,
} = {}) {
  const user = JSON.stringify({ id, first_name: 'Test', last_name: 'Bot', username: 'test_bot', language_code: 'ru' });
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: 'AAA', user });
  /* Seit Bot API 8.0 liegt `signature` bei. Für die Prüfung mit dem Bot-Token
     zählt es mit — ausgenommen wird nur `hash`. */
  if (signature) params.set('signature', signature);
  const checkString = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  params.set('hash', broken ? hash.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) : hash);
  return params.toString();
}

async function call(path, { method = 'GET', body, bearer, csrf, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

async function main() {
  if (!TOKEN) {
    console.log('\n  TELEGRAM_BOT_TOKEN fehlt — der Test kann ohne Token nichts unterschreiben.');
    console.log('  Beispiel:  TELEGRAM_BOT_TOKEN=123:TEST node scripts/test-telegram.js\n');
    process.exit(1);
  }

  console.log(`\nTelegram-Anbindung · ${BASE} · Test-Konto ${TELEGRAM_ID}\n`);

  console.log('1) Signaturprüfung');
  const forged = await call('/api/admin/session/telegram', { method: 'POST', body: { initData: initData({ broken: true }) } });
  check('gefälschte Signatur -> 401', forged.status === 401 && forged.body.error === 'telegram_invalid',
    `(${forged.status} ${forged.body.error})`);

  const foreign = await call('/api/admin/session/telegram', {
    method: 'POST', body: { initData: initData({ token: '999999:ein-anderer-bot' }) },
  });
  check('mit fremdem Bot-Token unterschrieben -> 401', foreign.status === 401 && foreign.body.error === 'telegram_invalid',
    `(${foreign.status} ${foreign.body.error})`);

  const empty = await call('/api/admin/session/telegram', { method: 'POST', body: {} });
  check('ohne initData -> 401', empty.status === 401, `(${empty.status})`);

  const old = await call('/api/admin/session/telegram', {
    method: 'POST', body: { initData: initData({ authDate: Math.floor(Date.now() / 1000) - 40 * 60 * 60 }) },
  });
  check('auth_date älter als 24 h -> 401 telegram_expired',
    old.status === 401 && old.body.error === 'telegram_expired', `(${old.status} ${old.body.error})`);

  const signed = await call('/api/admin/session/telegram', {
    method: 'POST', body: { initData: initData({ signature: 'BQ_Pv3N1lKt4c2s' }) },
  });
  check('initData mit signature-Feld (Bot API 8.0) wird angenommen -> 403 statt 401',
    signed.status === 403 && signed.body.error === 'telegram_not_linked', `(${signed.status} ${signed.body.error})`);

  console.log('\n2) Ohne Verknüpfung');
  const unlinked = await call('/api/admin/session/telegram', { method: 'POST', body: { initData: initData() } });
  check('gültige Signatur, aber nicht verknüpft -> 403 telegram_not_linked',
    unlinked.status === 403 && unlinked.body.error === 'telegram_not_linked', `(${unlinked.status} ${unlinked.body.error})`);
  check('keine Sitzungsdaten in der Antwort', !unlinked.body.token && !unlinked.body.user);

  console.log('\n3) Verknüpfen');
  const wrongPassword = await call('/api/admin/session/telegram/link', {
    method: 'POST', body: { initData: initData(), email: OWNER_EMAIL, password: 'falsch-falsch-falsch' },
  });
  check('falsches Passwort -> 401', wrongPassword.status === 401 && wrongPassword.body.error === 'invalid_credentials',
    `(${wrongPassword.status} ${wrongPassword.body.error})`);

  const wrongSignature = await call('/api/admin/session/telegram/link', {
    method: 'POST', body: { initData: initData({ broken: true }), email: OWNER_EMAIL, password: OWNER_PASSWORD },
  });
  check('richtiges Passwort, falsche Signatur -> 401', wrongSignature.status === 401,
    `(${wrongSignature.status} ${wrongSignature.body.error})`);

  const linked = await call('/api/admin/session/telegram/link', {
    method: 'POST', body: { initData: initData(), email: OWNER_EMAIL, password: OWNER_PASSWORD },
  });
  check('richtige Zugangsdaten -> 201 mit Token', linked.status === 201 && typeof linked.body.token === 'string',
    `(${linked.status} ${linked.body.error ?? ''})`);
  check('Antwort enthält Benutzer, Betrieb und Zeitzone',
    linked.body.user?.role === 'OWNER' && Boolean(linked.body.business?.timezone), JSON.stringify(linked.body.user ?? {}));

  const token = linked.body.token;
  if (!token) {
    console.log('\n  Ohne Token geht es nicht weiter.\n');
    process.exit(1);
  }

  console.log('\n4) Anmeldung nur mit initData');
  const again = await call('/api/admin/session/telegram', { method: 'POST', body: { initData: initData() } });
  check('zweiter Start -> 200 mit neuem Token', again.status === 200 && typeof again.body.token === 'string',
    `(${again.status} ${again.body.error ?? ''})`);
  check('neues Token ist nicht das alte', again.body.token !== token);

  console.log('\n5) Bearer-Sitzung');
  const me = await call('/api/admin/session', { bearer: token });
  check('GET /session mit Bearer -> 200', me.status === 200 && me.body.user?.email?.toLowerCase() === OWNER_EMAIL.toLowerCase(),
    `(${me.status})`);

  const overview = await call('/api/admin/overview', { bearer: token });
  check('Dashboard mit Bearer -> 200', overview.status === 200, `(${overview.status})`);

  const noToken = await call('/api/admin/overview');
  check('Dashboard ohne Token -> 401', noToken.status === 401, `(${noToken.status})`);

  const wrongToken = await call('/api/admin/overview', { bearer: `${token.slice(0, -4)}zzzz` });
  check('Dashboard mit verändertem Token -> 401', wrongToken.status === 401, `(${wrongToken.status})`);

  /* Schreiben ohne CSRF-Token: für Cookie-Sitzungen ein Fehler, für die Mini App
     der Normalfall — einen Authorization-Header kann keine fremde Seite setzen. */
  const write = await call('/api/admin/services', {
    method: 'POST', bearer: token,
    body: { name: `Telegram-Test ${TELEGRAM_ID}`, durationMinutes: 30, priceCents: 1000 },
  });
  check('Schreiben mit Bearer ohne CSRF-Token -> 201', write.status === 201, `(${write.status} ${write.body.error ?? ''})`);
  if (write.status === 201) {
    const removed = await call(`/api/admin/services/${write.body.service.id}`, { method: 'DELETE', bearer: token });
    check('Testleistung wieder gelöscht', removed.status === 200, `(${removed.status})`);
  }

  const cookieWrite = await call('/api/admin/services', {
    method: 'POST', cookie: 'bb_session=erfunden', body: { name: 'Darf nicht entstehen', durationMinutes: 30, priceCents: 1000 },
  });
  check('Cookie-Weg bleibt geschützt (erfundenes Cookie -> 401)', cookieWrite.status === 401, `(${cookieWrite.status})`);

  console.log('\n6) Verknüpfungen verwalten');
  const status = await call('/api/admin/telegram', { bearer: token });
  const entry = status.body.accounts?.find((account) => account.name === 'Test Bot');
  check('GET /telegram listet die Verknüpfung', status.status === 200 && Boolean(entry), `(${status.status})`);
  check('Verknüpfung zeigt das eigene Konto', entry?.isSelf === true && entry?.account?.email?.toLowerCase() === OWNER_EMAIL.toLowerCase());
  check('Bot-Zustand wird gemeldet', typeof status.body.bot?.configured === 'boolean');

  const anonymous = await call('/api/admin/telegram');
  check('GET /telegram ohne Anmeldung -> 401', anonymous.status === 401, `(${anonymous.status})`);

  const unlinkUnknown = await call('/api/admin/telegram/nicht-echt', { method: 'DELETE', bearer: token });
  check('Löschen mit ungültiger Kennung -> 400/404', [400, 404].includes(unlinkUnknown.status), `(${unlinkUnknown.status})`);

  const unlink = await call(`/api/admin/telegram/${entry?.id}`, { method: 'DELETE', bearer: token });
  check('Verknüpfung gelöst -> 200', unlink.status === 200, `(${unlink.status})`);

  const afterUnlink = await call('/api/admin/session/telegram', { method: 'POST', body: { initData: initData() } });
  check('danach ist der Start wieder nicht verknüpft -> 403',
    afterUnlink.status === 403 && afterUnlink.body.error === 'telegram_not_linked', `(${afterUnlink.status})`);

  console.log('\n7) Webhook des Bots');
  const hookWithoutSecret = await call('/api/telegram', { method: 'POST', body: { update_id: 1 } });
  check('Webhook ohne gültiges Secret -> 401/503', [401, 503].includes(hookWithoutSecret.status), `(${hookWithoutSecret.status})`);
  const hookGet = await call('/api/telegram');
  check('Webhook mit GET -> 405/503', [405, 503].includes(hookGet.status), `(${hookGet.status})`);

  console.log(`\n  ${pass} bestanden, ${fail} fehlgeschlagen\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
