# MasterTabel

Employee time tracking for a small business: employees check in and out with a Telegram bot; the owner reviews, edits and pays from a mobile-friendly admin panel. Armenian by default, Russian and English for employees, English for the panel.

One Node.js process runs everything: the admin panel, the Telegram bot and the reminder scheduler. Data lives in PostgreSQL.

## Launch on Railway (about 15 minutes, no coding)

You need: a Telegram account, a GitHub account and a Railway account. Cost: Railway Hobby plan, about $5/month.

### 1. Create your bot in Telegram (2 minutes)
1. In Telegram, open **@BotFather** and send `/newbot`.
2. Send a display name, e.g. `MasterTabel`.
3. Send a username ending in `bot`, e.g. `mycompany_tabel_bot`.
4. BotFather replies with a **token** like `7412345678:AAH...`. Keep it private. You'll paste it in step 3.

### 2. Put the code on GitHub
Create an empty **private** repository named `mastertabel` on github.com, then either let Claude push the code to it, or upload the files with **Add file → Upload files** (drag in the contents of this folder, without `node_modules` and `data`).

### 3. Deploy on Railway
1. Go to **railway.com**, sign in with GitHub, choose the Hobby plan.
2. **New Project → Deploy from GitHub repo →** pick `mastertabel`.
3. In the project, **+ Create → Database → PostgreSQL**.
4. Open the `mastertabel` service → **Variables** → add:
   - `BOT_TOKEN` = the token from BotFather
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (type it exactly like this)
5. **Settings → Networking → Generate Domain.** That address is your admin panel.
6. Railway redeploys automatically. When the deployment shows **Active**, open the domain.

### 4. First login
1. Open your admin panel address. You'll see **Connect your Telegram**.
2. Tap **Log in with Telegram** → Telegram opens your bot → press **Start**.
3. The page logs you in. From now on only your Telegram account can open the panel.

### 5. Add employees
**Employees → Add employee**, fill in name, phone, rate and schedule, then copy the **invite link** and send it to the employee. They tap it, press Start, share their number, and they're in.

## Settings you can change
Variables (Railway → Variables): `BOT_TOKEN` (required), `DATABASE_URL` (required), `PUBLIC_URL` (optional, your own domain).
Everything else is in the panel under Settings.

## For developers
```
npm install
npm test                    # rules, payroll, bot, reminders
node scripts/demo-data.js   # sample data in ./data
npm run dev                 # http://localhost:3000, "Dev login" button, no bot
```
Without `DATABASE_URL` the app uses an embedded Postgres (PGlite) in `./data` for local use only.
Times are Yerevan time (UTC+4). Code map: `src/core` (rules, pay), `src/bot.js`, `src/reminders.js`, `src/web` (admin panel), `src/export.js` (Excel).
