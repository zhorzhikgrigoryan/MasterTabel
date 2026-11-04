// Admin login through the Telegram bot (no passwords). Several admins, all with full access.
// Login: browser gets a token -> admin opens t.me link -> bot confirms -> browser polls and gets a session.
// Claim: the very first person to log in becomes the first admin.
// Invite: an admin creates a one-time link; whoever opens it in Telegram becomes an admin.
import { q, one } from '../db.js';
import { newToken } from './employees.js';
import { getOwner } from './settings.js';

const LOGIN_TTL_MIN = 15;
const INVITE_TTL_MIN = 24 * 60;
const SESSION_DAYS = 30;

/** Move the original single owner into the admins table (one-time, on start). */
export async function migrateAdmins() {
  const n = await one('SELECT count(*)::int AS n FROM admins');
  if (n.n > 0) return;
  const owner = await getOwner();
  if (owner) await addAdmin(owner.telegram_id, owner.name, null);
}

export const listAdmins = () => q('SELECT * FROM admins ORDER BY added_at');
export async function isAdmin(telegramId) {
  return !!(await one('SELECT 1 FROM admins WHERE telegram_id=$1', [String(telegramId)]));
}
export async function hasAdmins() {
  return (await one('SELECT count(*)::int AS n FROM admins')).n > 0;
}
async function addAdmin(telegramId, name, addedBy) {
  await q(`INSERT INTO admins (telegram_id, name, added_by) VALUES ($1,$2,$3)
           ON CONFLICT (telegram_id) DO UPDATE SET name = COALESCE(NULLIF(EXCLUDED.name, ''), admins.name)`,
  [String(telegramId), name || '', addedBy ? String(addedBy) : null]);
}

/** Remove an admin and end their sessions. The last admin can't be removed. */
export async function removeAdmin(telegramId) {
  const all = await listAdmins();
  if (all.length <= 1) return 'last';
  await q('DELETE FROM admins WHERE telegram_id=$1', [String(telegramId)]);
  await q('DELETE FROM sessions WHERE telegram_id=$1', [String(telegramId)]);
  return 'ok';
}

export async function createAuthToken(kind, createdBy = null) {
  const token = newToken(16);
  await q('INSERT INTO auth_tokens (token, kind, telegram_id) VALUES ($1,$2,$3)', [token, kind, createdBy ? String(createdBy) : null]);
  return token;
}

async function freshToken(token, kind) {
  const ttl = kind === 'invite' ? INVITE_TTL_MIN : LOGIN_TTL_MIN;
  return one(
    `SELECT * FROM auth_tokens WHERE token=$1 AND kind=$2 AND status='waiting'
     AND created_at > now() - ($3 || ' minutes')::interval`, [token, kind, String(ttl)],
  );
}

/** Called by the bot. Returns 'ok' | 'added' | 'expired' | 'not_admin' | 'taken'. */
export async function confirmToken(kind, token, telegramId, name) {
  const row = await freshToken(token, kind);
  if (!row) return 'expired';
  if (kind === 'invite') {
    await addAdmin(telegramId, name, row.telegram_id);
    await q(`UPDATE auth_tokens SET status='used', telegram_id=$2 WHERE token=$1`, [token, String(telegramId)]);
    return 'added';
  }
  if (kind === 'claim') {
    if (await hasAdmins()) return 'taken';
    await addAdmin(telegramId, name, null);
  } else if (!(await isAdmin(telegramId))) {
    return 'not_admin';
  } else {
    await addAdmin(telegramId, name, null); // refresh the display name
  }
  await q(`UPDATE auth_tokens SET status='confirmed', telegram_id=$2 WHERE token=$1`, [token, String(telegramId)]);
  return 'ok';
}

/** Called by the browser while waiting. Returns a session token once confirmed. */
export async function exchangeToken(token) {
  const row = await one(`SELECT * FROM auth_tokens WHERE token=$1 AND status='confirmed' AND kind IN ('claim','login')`, [token]);
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

/** Returns the logged-in admin's Telegram ID, or null. */
export async function sessionAdmin(token) {
  if (!token) return null;
  const s = await one(
    `SELECT s.telegram_id FROM sessions s JOIN admins a ON a.telegram_id = s.telegram_id
     WHERE s.token=$1 AND s.expires_at > now()`, [token]);
  return s ? String(s.telegram_id) : null;
}
export const validSession = async (token) => !!(await sessionAdmin(token));

export const logout = (token) => q('DELETE FROM sessions WHERE token=$1', [token]);
