/* Webhook des Telegram-Bots.

   Der Bot selbst kann wenig: Er begrüßt und zeigt den Knopf, der die Verwaltung
   als Mini App öffnet. Alles Weitere passiert in der Mini App, die sich über
   /api/admin/session/telegram anmeldet (lib/admin/telegram.js).

   Sicherheit: Telegram schickt bei jedem Aufruf den in setWebhook hinterlegten
   `secret_token` im Header mit. Ohne passenden Wert wird nichts beantwortet —
   sonst könnte jeder Antworten im Namen des Bots auslösen. Eingerichtet wird das
   mit `node scripts/telegram-setup.js`.

   Es werden keine Daten aus dem Betrieb verschickt: Termine, Namen und Umsätze
   verlassen die Verwaltung nicht über den Bot. */
import { json, fail, methodNotAllowed, readJson } from '../lib/http.js';
import { callApi, isConfigured, baseUrl } from '../lib/telegram.js';

/* Die Oberfläche der Verwaltung kann Deutsch, Russisch und Türkisch — der Bot
   antwortet in derselben Sprache, sofern Telegram sie meldet. */
const TEXTS = {
  de: {
    welcome: 'Willkommen in der Verwaltung des Bregenz Barbershop.\n\nÖffne sie mit dem Knopf unten. Beim ersten Mal meldest du dich einmalig mit E-Mail und Passwort an, danach genügt dieser Knopf.',
    open: 'Verwaltung öffnen',
    help: 'Mit dem Knopf unten öffnest du die Verwaltung. Bei Fragen zum Zugang wende dich an den Inhaber.',
    unknown: 'Diesen Befehl kenne ich nicht. Mit /start öffnest du die Verwaltung.',
  },
  ru: {
    welcome: 'Панель управления Bregenz Barbershop.\n\nОткройте её кнопкой ниже. В первый раз нужно один раз войти по e-mail и паролю, дальше достаточно этой кнопки.',
    open: 'Открыть панель',
    help: 'Кнопка ниже открывает панель управления. По вопросам доступа обратитесь к владельцу.',
    unknown: 'Такой команды я не знаю. Откройте панель командой /start.',
  },
  tr: {
    welcome: 'Bregenz Barbershop yönetim paneli.\n\nAşağıdaki düğmeyle açabilirsin. İlk seferde e-posta ve şifreyle bir kez giriş yaparsın, sonra bu düğme yeter.',
    open: 'Yönetimi aç',
    help: 'Aşağıdaki düğme yönetim panelini açar. Erişim sorularında işletme sahibine başvur.',
    unknown: 'Bu komutu bilmiyorum. /start ile yönetimi açabilirsin.',
  },
};

const textsFor = (languageCode) => TEXTS[String(languageCode ?? '').slice(0, 2).toLowerCase()] ?? TEXTS.de;

async function reply(chatId, text, { button = null } = {}) {
  await callApi('sendMessage', {
    chat_id: chatId,
    text,
    // Mini-App-Knöpfe brauchen HTTPS; lokal gibt es sie deshalb nicht.
    ...(button ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim();
  if (!isConfigured() || !secret) {
    return fail(res, 503, 'telegram_disabled', 'Der Telegram-Bot ist nicht eingerichtet.');
  }
  if (req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return fail(res, 401, 'unauthorized', 'Nicht erlaubt.');
  }

  let update;
  try {
    update = await readJson(req, { limit: 200_000 });
  } catch {
    return fail(res, 400, 'invalid_body', 'Die Anfrage konnte nicht gelesen werden.');
  }

  const message = update?.message ?? update?.edited_message;
  const chat = message?.chat;
  /* Nur Einzelchats: in Gruppen hätte der Knopf keinen Nutzen, und die Mini App
     lässt sich dort ohnehin nicht öffnen. */
  if (!chat || chat.type !== 'private' || typeof message.text !== 'string') {
    return json(res, 200, { ok: true });
  }

  const texts = textsFor(message.from?.language_code);
  const base = baseUrl();
  const button = base.startsWith('https://')
    ? { text: texts.open, web_app: { url: `${base}/admin` } }
    : null;
  const command = message.text.trim().split(/[\s@]/)[0].toLowerCase();

  try {
    if (command === '/start' || command === '/admin' || command === '/verwaltung') {
      await reply(chat.id, texts.welcome, { button });
    } else if (command === '/help' || command === '/hilfe') {
      await reply(chat.id, texts.help, { button });
    } else if (command.startsWith('/')) {
      await reply(chat.id, texts.unknown);
    } else {
      await reply(chat.id, texts.help, { button });
    }
  } catch (err) {
    // Telegram wiederholt fehlgeschlagene Updates; ein 200 beendet die Schleife.
    console.error('[telegram:webhook]', err?.message ?? err);
  }

  return json(res, 200, { ok: true });
}
