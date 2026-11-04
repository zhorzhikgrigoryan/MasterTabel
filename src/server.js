// MasterTabel entry point: web admin panel + Telegram bot + reminder scheduler, in one process.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './db.js';
import { adminRouter } from './web/routes.js';
import { createBot, reminderSender, publicUrl, rememberPublicUrl } from './bot.js';
import { getSettings, setSetting } from './core/settings.js';
import { startScheduler } from './reminders.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

async function main() {
  if (!process.env.DATABASE_URL && (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production')) {
    console.error('DATABASE_URL is missing. Add the Postgres database and the DATABASE_URL variable (see README). Not starting, so no data is lost.');
    process.exit(1);
  }
  await connect();
  const saved = (await getSettings()).public_url;
  if (saved) rememberPublicUrl(saved);
  console.log(process.env.DATABASE_URL ? 'Database: PostgreSQL' : 'Database: local (./data)');

  let botUsername = null;
  const token = process.env.BOT_TOKEN;
  if (token) {
    const { bot } = createBot(token);
    await bot.init();
    botUsername = bot.botInfo.username;
    await bot.api.setMyCommands([{ command: 'start', description: 'Start / Սկսել' }]).catch(() => {});
    bot.start({ drop_pending_updates: false, onStart: () => console.log(`Bot @${botUsername} is running`) })
      .catch((e) => console.error('Bot stopped:', e.message));
    startScheduler(reminderSender(bot));
  } else {
    console.warn('BOT_TOKEN is not set: the Telegram bot and reminders are off.');
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.get('/health', (req, res) => res.json({ ok: true }));
  // Learn the panel's public address from real visits, so bot links never say "localhost".
  app.use((req, res, next) => {
    const host = req.get('x-forwarded-host') || req.get('host');
    if (host && !/localhost|127\.0\.0\.1/.test(host)) {
      const url = `${req.protocol}://${host}`;
      if (url !== publicUrl()) { rememberPublicUrl(url); setSetting('public_url', url).catch(() => {}); }
    }
    next();
  });
  app.use('/static', express.static(path.join(here, '..', 'public'), { maxAge: '1h' }));
  app.use(adminRouter({ botUsername: () => botUsername }));
  app.use((err, req, res, next) => { console.error(err); res.status(500).send('Something went wrong. Please go back and try again.'); });
  app.listen(PORT, () => console.log(`Admin panel: ${publicUrl()}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
