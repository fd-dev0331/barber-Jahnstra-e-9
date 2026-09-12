/* Einmalige Einrichtung des Telegram-Bots.

   Aufruf:
     node scripts/telegram-setup.js                     # nutzt PUBLIC_BASE_URL
     node scripts/telegram-setup.js https://example.com # oder diese Adresse
     node scripts/telegram-setup.js --status            # nur anzeigen, nichts ändern

   Was das Skript setzt:
     · Menüknopf des Bots  -> öffnet <BASE>/admin als Mini App
     · Befehle /start /help in Deutsch, Russisch und Türkisch
     · Webhook auf <BASE>/api/telegram, abgesichert mit TELEGRAM_WEBHOOK_SECRET

   Nötige Werte in .env bzw. in den Vercel-Umgebungsvariablen:
     TELEGRAM_BOT_TOKEN       vom @BotFather
     TELEGRAM_WEBHOOK_SECRET  frei gewählt, z. B.
                              node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
     PUBLIC_BASE_URL          https-Adresse der Website */
import { loadEnv } from './env.js';

loadEnv();

const args = process.argv.slice(2);
const statusOnly = args.includes('--status');
const baseArg = args.find((arg) => !arg.startsWith('-'));
const BASE = (baseArg ?? process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
const SECRET = (process.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim();

function bail(message) {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

async function api(method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!data?.ok) throw new Error(`${method}: ${data?.description ?? `HTTP ${response.status}`}`);
  return data.result;
}

const COMMANDS = {
  de: [{ command: 'start', description: 'Verwaltung öffnen' }, { command: 'help', description: 'Hilfe' }],
  ru: [{ command: 'start', description: 'Открыть панель' }, { command: 'help', description: 'Помощь' }],
  tr: [{ command: 'start', description: 'Yönetimi aç' }, { command: 'help', description: 'Yardım' }],
};

async function main() {
  if (!TOKEN) bail('TELEGRAM_BOT_TOKEN fehlt. Token beim @BotFather holen und in .env eintragen.');

  const me = await api('getMe');
  console.log(`\n  Bot: @${me.username} (${me.first_name})`);

  if (statusOnly) {
    const hook = await api('getWebhookInfo');
    const menu = await api('getChatMenuButton');
    console.log(`  Webhook:   ${hook.url || '— nicht gesetzt —'}`);
    if (hook.last_error_message) console.log(`  Letzter Fehler: ${hook.last_error_message}`);
    console.log(`  Menüknopf: ${menu.type === 'web_app' ? menu.web_app.url : menu.type}`);
    console.log('');
    return;
  }

  if (!BASE.startsWith('https://')) {
    bail('Eine https-Adresse wird gebraucht: PUBLIC_BASE_URL setzen oder als Argument übergeben.\n'
      + '    Telegram öffnet Mini Apps nur über https — http://localhost geht nicht.');
  }

  await api('setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Verwaltung', web_app: { url: `${BASE}/admin` } },
  });
  console.log(`  ✔ Menüknopf -> ${BASE}/admin`);

  for (const [language, commands] of Object.entries(COMMANDS)) {
    await api('setMyCommands', { commands, language_code: language === 'de' ? undefined : language });
  }
  console.log('  ✔ Befehle /start und /help (de, ru, tr)');

  if (SECRET) {
    await api('setWebhook', {
      url: `${BASE}/api/telegram`,
      secret_token: SECRET,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });
    console.log(`  ✔ Webhook -> ${BASE}/api/telegram`);
  } else {
    console.log('  … Webhook übersprungen: TELEGRAM_WEBHOOK_SECRET fehlt.');
    console.log('    Ohne Webhook antwortet der Bot nicht auf /start — der Menüknopf funktioniert trotzdem.');
  }

  console.log(`\n  Fertig. Bot öffnen: https://t.me/${me.username}\n`);
}

main().catch((err) => bail(err.message));
