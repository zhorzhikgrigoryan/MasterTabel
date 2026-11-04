// Owner login through the Telegram bot (no passwords).
// 1. Browser asks for a token; page shows a t.me link with it.
// 2. Owner taps the link -> bot confirms the token for that Telegram account.
// 3. Browser polls; once confirmed it receives a session cookie.
import { q, one } from '../db.js';
import { newToken } from './employees.js';
import { getOwner, setSetting } from './settings.js';

const TOKEN_TTL_MIN = 15;
const SESSION_DAYS = 30;

export async function createAuthToken(kind) {
  const token = newToken(16);
  await q('INSERT INTO auth_tokens (token, kind) VALUES ($1,$2)', [token, kind]);
  return token;
}

async function freshToken(token, kind) {
  return one(
    `SELECT * FROM auth_tokens WHERE token=$1 AND kind=$2 AND status='waiting'
     AND created_at > now() - ($3 || ' minutes')::interval`, [token, kind, String(TOKEN_TTL_MIN)],
  );
}

/** Called by the bot. Returns 'ok' | 'expired' | 'not_owner' | 'taken'. */
export async function confirmToken(kind, token, telegramId, name) {
  const row = await freshToken(token, kind);
  if (!row) return 'expired';
  const owner = await getOwner();
  if (kind === 'claim') {
    if (owner) return 'taken';
    await setSetting('owner', { telegram_id: String(telegramId), name: name || '' });
  } else if (!owner || String(owner.telegram_id) !== String(telegramId)) {
    return 'not_owner';
  }
  await q(`UPDATE auth_tokens SET status='confirmed', telegram_id=$2 WHERE token=$1`, [token, String(telegramId)]);
  return 'ok';
}

/** Called by the browser while waiting. Returns a session token once confirmed. */
export async function exchangeToken(token) {
  const row = await one(`SELECT * FROM auth_tokens WHERE token=$1 AND status='confirmed'`, [token]);
  if (!row) return null;
  await q(`UPDATE auth_tokens SET status='used' WHERE token=$1`, [token]);
  return createSession(row.telegram_id);
}

export async function createSession(telegramId) {
  const s = newToken(24);
  await q(`INSERT INTO sessions (token, telegram_id, expires_at) VALUES ($1,$2, now() + ($3 || ' days')::interval)`,
    [s, String(telegramId), String(SESSION_DAYS)]);
  return s;
}

export async function validSession(token) {
  if (!token) return false;
  const s = await one('SELECT * FROM sessions WHERE token=$1 AND expires_at > now()', [token]);
  if (!s) return false;
  const owner = await getOwner();
  return !!owner && String(owner.telegram_id) === String(s.telegram_id);
}

export const logout = (token) => q('DELETE FROM sessions WHERE token=$1', [token]);
