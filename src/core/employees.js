import { randomBytes } from 'node:crypto';
import { q, one } from '../db.js';
import { today } from '../time.js';

export const newToken = (n = 12) => randomBytes(n).toString('base64url');

/** "1692,20" / "1 692.2" -> 1692.2 ; invalid -> NaN. Rates keep 2 decimals. */
export function parseRate(v) {
  const s = String(v ?? '').trim().replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100) / 100;
}

/** Keep digits; Armenian numbers compared by their last 8 digits. */
export function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}
export function samePhone(a, b) {
  const x = normalizePhone(a); const y = normalizePhone(b);
  if (!x || !y) return false;
  return x.slice(-8) === y.slice(-8);
}

export async function listEmployees({ includeInactive = false } = {}) {
  return q(
    `SELECT e.*, (SELECT hourly_amd FROM rates r WHERE r.employee_id = e.id AND r.effective_from <= $1
                  ORDER BY effective_from DESC LIMIT 1) AS current_rate
     FROM employees e
     ${includeInactive ? '' : `WHERE e.status <> 'deactivated'`}
     ORDER BY (e.status = 'deactivated'), e.full_name`,
    [today()],
  );
}

export const getEmployee = (id) => one('SELECT * FROM employees WHERE id = $1', [id]);
export const getByTelegram = (tid) => one('SELECT * FROM employees WHERE telegram_id = $1', [String(tid)]);
export const getByInvite = (token) => one('SELECT * FROM employees WHERE invite_token = $1', [token]);

function clean(data) {
  const days = Array.isArray(data.sched_days) ? data.sched_days : (data.sched_days ? [data.sched_days] : []);
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  return {
    full_name: String(data.full_name || '').trim(),
    phone: String(data.phone || '').trim(),
    break_min: num(data.break_min) ?? 0,
    pay_cycle: data.pay_cycle === 'weekly' ? 'weekly' : 'monthly',
    sched_days: days.map(Number).filter((d) => d >= 1 && d <= 7),
    sched_start: data.sched_start || null,
    sched_end: data.sched_end || null,
    remind_in_after: num(data.remind_in_after),
    remind_out_again: num(data.remind_out_again),
    notes: data.notes ? String(data.notes).trim() : null,
    lang: ['hy', 'ru', 'en'].includes(data.lang) ? data.lang : 'hy',
  };
}

export function validateEmployee(data) {
  const errors = [];
  const c = clean(data);
  if (!c.full_name) errors.push('name');
  if (normalizePhone(c.phone).length < 8) errors.push('phone');
  if (c.break_min < 0 || c.break_min > 600) errors.push('break');
  if (data.hourly_amd !== undefined && !(parseRate(data.hourly_amd) >= 0)) errors.push('rate');
  return errors;
}

export async function createEmployee(data) {
  const c = clean(data);
  const e = await one(
    `INSERT INTO employees (full_name, phone, break_min, pay_cycle, sched_days, sched_start, sched_end,
                            remind_in_after, remind_out_again, notes, lang, invite_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [c.full_name, c.phone, c.break_min, c.pay_cycle, c.sched_days, c.sched_start, c.sched_end,
      c.remind_in_after, c.remind_out_again, c.notes, c.lang, newToken()],
  );
  const rate = parseRate(data.hourly_amd);
  if (rate >= 0) await setRate(e.id, rate, data.rate_from || today());
  return e;
}

export async function updateEmployee(id, data) {
  const c = clean(data);
  return one(
    `UPDATE employees SET full_name=$2, phone=$3, break_min=$4, pay_cycle=$5, sched_days=$6, sched_start=$7,
            sched_end=$8, remind_in_after=$9, remind_out_again=$10, notes=$11, lang=$12
     WHERE id=$1 RETURNING *`,
    [id, c.full_name, c.phone, c.break_min, c.pay_cycle, c.sched_days, c.sched_start, c.sched_end,
      c.remind_in_after, c.remind_out_again, c.notes, c.lang],
  );
}

export async function setStatus(id, status) {
  return one('UPDATE employees SET status=$2 WHERE id=$1 RETURNING *', [id, status]);
}

export async function reactivate(id) {
  const e = await getEmployee(id);
  return setStatus(id, e.telegram_id ? 'active' : 'invited');
}

export async function regenerateInvite(id) {
  return one(
    `UPDATE employees SET invite_token=$2, telegram_id=NULL, tg_username=NULL,
            status = CASE WHEN status='deactivated' THEN status ELSE 'invited' END
     WHERE id=$1 RETURNING *`,
    [id, newToken()],
  );
}

export async function setLang(id, lang) {
  return one('UPDATE employees SET lang=$2 WHERE id=$1 RETURNING *', [id, lang]);
}

/** Bot join: invite token + shared phone must match. */
export async function linkTelegram(token, telegramId, phone, username) {
  const e = await getByInvite(token);
  if (!e || e.status === 'deactivated') return { error: 'token' };
  if (!samePhone(e.phone, phone)) return { error: 'phone', employee: e };
  const other = await getByTelegram(telegramId);
  if (other && other.id !== e.id) {
    await q(`UPDATE employees SET telegram_id=NULL WHERE id=$1`, [other.id]);
  }
  const linked = await one(
    `UPDATE employees SET telegram_id=$2, tg_username=$3, status='active' WHERE id=$1 RETURNING *`,
    [e.id, String(telegramId), username || null],
  );
  return { ok: true, employee: linked };
}

// ---- Rates ----
export async function setRate(employeeId, hourlyAmd, effectiveFrom) {
  return one(
    `INSERT INTO rates (employee_id, hourly_amd, effective_from) VALUES ($1,$2,$3)
     ON CONFLICT (employee_id, effective_from) DO UPDATE SET hourly_amd = EXCLUDED.hourly_amd
     RETURNING *`,
    [employeeId, Math.round(Number(hourlyAmd) * 100) / 100, effectiveFrom],
  );
}
export const listRates = (employeeId) =>
  q('SELECT * FROM rates WHERE employee_id=$1 ORDER BY effective_from DESC', [employeeId]);
export const deleteRate = (id) => q('DELETE FROM rates WHERE id=$1', [id]);

/** Rate valid on a date, from a list sorted by effective_from DESC. */
export function rateOn(rates, date) {
  for (const r of rates) if (r.effective_from <= date) return r.hourly_amd;
  return 0;
}
