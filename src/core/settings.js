import { q, one } from '../db.js';

export const DEFAULTS = {
  rounding: 0,            // minutes: 0 (exact), 5, 10, 15
  window_start: '05:00',
  window_end: '23:59',
  remind_in_after: 15,    // minutes after expected start
  remind_out_again: 60,   // minutes after expected end, second reminder
  late_grace: 5,          // minutes after expected start before "late"
  notify_owner_requests: true,
  admin_lang: 'hy',
};

export async function getSettings() {
  const rows = await q('SELECT key, value FROM settings');
  const s = { ...DEFAULTS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}

export async function setSetting(key, value) {
  await q(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}

export async function getOwner() {
  const r = await one(`SELECT value FROM settings WHERE key = 'owner'`);
  return r ? r.value : null;
}
