// Check-in / check-out rules (spec: "Time-tracking rules").
import { q, one } from '../db.js';
import { dateOf, today, at, hm, hmToMin, minutesOfDay, weekday } from '../time.js';
import { isLocked } from './payroll.js';

export class RuleError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}

function flagsFor(emp, instant, settings) {
  const mins = minutesOfDay(instant);
  const outside = mins < hmToMin(settings.window_start) || mins > hmToMin(settings.window_end);
  let late = false;
  const date = dateOf(instant);
  if (emp.sched_start && (emp.sched_days || []).includes(weekday(date))) {
    late = mins > hmToMin(emp.sched_start) + Number(settings.late_grace || 0);
  }
  return { outside, late };
}

export const openShift = (employeeId) =>
  one(`SELECT * FROM shifts WHERE employee_id=$1 AND status='open' ORDER BY check_in DESC LIMIT 1`, [employeeId]);

export const shiftsOn = (employeeId, date) =>
  q(`SELECT * FROM shifts WHERE employee_id=$1 AND work_date=$2 ORDER BY check_in`, [employeeId, date]);

export const getShift = (id) => one('SELECT * FROM shifts WHERE id=$1', [id]);

async function log(shift, field, oldV, newV, reason) {
  await q(
    `INSERT INTO shift_edits (shift_id, employee_id, work_date, field, old_value, new_value, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [shift.id ?? null, shift.employee_id, shift.work_date, field, oldV ?? null, newV ?? null, reason || null],
  );
}

/** Close yesterday's (or older) open shift into review so it can't block today. */
async function settleStale(employeeId, now) {
  await q(`UPDATE shifts SET status='review' WHERE employee_id=$1 AND status='open' AND work_date < $2`,
    [employeeId, dateOf(now)]);
}

// ---------- Employee actions (bot) ----------

export async function checkIn(emp, settings, now = new Date()) {
  await settleStale(emp.id, now);
  const open = await openShift(emp.id);
  if (open) throw new RuleError('already_in', { shift: open });
  const f = flagsFor(emp, now, settings);
  return one(
    `INSERT INTO shifts (employee_id, work_date, check_in, in_source, status, late, out_of_window)
     VALUES ($1,$2,$3,'tap','open',$4,$5) RETURNING *`,
    [emp.id, dateOf(now), now, f.late, f.outside],
  );
}

export async function checkOut(emp, settings, now = new Date()) {
  await settleStale(emp.id, now);
  const open = await openShift(emp.id);
  if (!open) throw new RuleError('not_in');
  if (new Date(open.check_in) > now) throw new RuleError('before_in', { shift: open });
  return one(
    `UPDATE shifts SET check_out=$2, out_source='tap', status='closed' WHERE id=$1 RETURNING *`,
    [open.id, now],
  );
}

/** "I forgot to check in" — employee gives today's time; flagged for approval. */
export async function requestIn(emp, time, settings, now = new Date()) {
  await settleStale(emp.id, now);
  if (await openShift(emp.id)) throw new RuleError('already_in');
  const date = dateOf(now);
  const inst = at(date, time);
  if (inst > now) throw new RuleError('future');
  const last = await one(
    `SELECT * FROM shifts WHERE employee_id=$1 AND work_date=$2 AND check_out IS NOT NULL
     ORDER BY check_out DESC LIMIT 1`, [emp.id, date]);
  if (last && new Date(last.check_out) > inst) throw new RuleError('overlap', { shift: last });
  const f = flagsFor(emp, inst, settings);
  const s = await one(
    `INSERT INTO shifts (employee_id, work_date, check_in, in_source, status, needs_approval, late, out_of_window)
     VALUES ($1,$2,$3,'request','open',true,$4,$5) RETURNING *`,
    [emp.id, date, inst, f.late, f.outside],
  );
  await log(s, 'requested_in', null, time, null);
  return s;
}

/** "I forgot to check out" — closes the latest open/review shift at the given time; flagged. */
export async function requestOut(emp, time, settings, now = new Date()) {
  const target = await one(
    `SELECT * FROM shifts WHERE employee_id=$1 AND status IN ('open','review')
     ORDER BY check_in DESC LIMIT 1`, [emp.id]);
  if (!target) throw new RuleError('not_in');
  const inst = at(target.work_date, time);
  if (inst <= new Date(target.check_in)) throw new RuleError('before_in', { shift: target });
  if (inst > now) throw new RuleError('future');
  const s = await one(
    `UPDATE shifts SET check_out=$2, out_source='request', status='closed', needs_approval=true
     WHERE id=$1 RETURNING *`, [target.id, inst]);
  await log(s, 'requested_out', null, time, null);
  return s;
}

/** Shift that "I forgot to check out" would close, if any. */
export const forgotOutTarget = (employeeId) =>
  one(`SELECT * FROM shifts WHERE employee_id=$1 AND status IN ('open','review') ORDER BY check_in DESC LIMIT 1`,
    [employeeId]);

// ---------- Owner actions (admin panel) ----------

async function guardLock(employeeId, date) {
  if (await isLocked(employeeId, date)) throw new RuleError('locked');
}

function statusFor(date, out, settings, now = new Date()) {
  if (out) return 'closed';
  if (date < dateOf(now)) return 'review';
  if (date === dateOf(now) && minutesOfDay(now) >= hmToMin(settings.window_end)) return 'review';
  return 'open';
}

export async function adminCreate(emp, date, inTime, outTime, reason, settings) {
  await guardLock(emp.id, date);
  const inI = at(date, inTime); const outI = outTime ? at(date, outTime) : null;
  if (outI && outI <= inI) throw new RuleError('out_before_in');
  const f = flagsFor(emp, inI, settings);
  const s = await one(
    `INSERT INTO shifts (employee_id, work_date, check_in, check_out, in_source, out_source, status, late,
                         out_of_window, edited)
     VALUES ($1,$2,$3,$4,'admin',$5,$6,$7,$8,true) RETURNING *`,
    [emp.id, date, inI, outI, outI ? 'admin' : null, statusFor(date, outI, settings), f.late, f.outside],
  );
  await log(s, 'created', null, `${inTime}–${outTime || '…'}`, reason);
  return s;
}

export async function adminUpdate(emp, shiftId, inTime, outTime, reason, settings) {
  const s = await getShift(shiftId);
  if (!s || s.employee_id !== emp.id) throw new RuleError('not_found');
  await guardLock(emp.id, s.work_date);
  const inI = at(s.work_date, inTime); const outI = outTime ? at(s.work_date, outTime) : null;
  if (outI && outI <= inI) throw new RuleError('out_before_in');
  const oldIn = hm(s.check_in); const oldOut = s.check_out ? hm(s.check_out) : null;
  const changedIn = oldIn !== inTime; const changedOut = (oldOut || null) !== (outTime || null);
  const f = flagsFor(emp, inI, settings);
  const upd = await one(
    `UPDATE shifts SET check_in=$2, check_out=$3, status=$4, needs_approval=false, out_of_window=$5, late=$6,
            edited = edited OR $7, in_source = CASE WHEN $8 THEN 'admin' ELSE in_source END,
            out_source = CASE WHEN $9 THEN 'admin' ELSE out_source END
     WHERE id=$1 RETURNING *`,
    [s.id, inI, outI, statusFor(s.work_date, outI, settings), f.outside, f.late,
      changedIn || changedOut, changedIn, changedOut],
  );
  if (changedIn) await log(s, 'check_in', oldIn, inTime, reason);
  if (changedOut) await log(s, 'check_out', oldOut, outTime || null, reason);
  if (!changedIn && !changedOut && s.needs_approval) await log(s, 'approved', null, null, reason);
  return upd;
}

export async function adminDelete(emp, shiftId, reason) {
  const s = await getShift(shiftId);
  if (!s || s.employee_id !== emp.id) throw new RuleError('not_found');
  await guardLock(emp.id, s.work_date);
  await q('DELETE FROM shifts WHERE id=$1', [s.id]);
  await log(s, 'deleted', `${hm(s.check_in)}–${s.check_out ? hm(s.check_out) : '…'}`, null, reason);
}

export async function approve(emp, shiftId) {
  const s = await getShift(shiftId);
  if (!s || s.employee_id !== emp.id) throw new RuleError('not_found');
  await q('UPDATE shifts SET needs_approval=false WHERE id=$1', [s.id]);
  await log(s, 'approved', null, null, null);
}

export async function setDayBreak(emp, date, minutes, reason) {
  await guardLock(emp.id, date);
  const prev = await one('SELECT break_min FROM day_breaks WHERE employee_id=$1 AND work_date=$2', [emp.id, date]);
  const oldV = prev ? prev.break_min : emp.break_min;
  if (minutes === null || minutes === undefined || minutes === '') {
    await q('DELETE FROM day_breaks WHERE employee_id=$1 AND work_date=$2', [emp.id, date]);
    if (prev) await log({ employee_id: emp.id, work_date: date }, 'break', `${oldV}`, `${emp.break_min}`, reason);
    return;
  }
  const m = Math.max(0, Math.round(Number(minutes)));
  await q(`INSERT INTO day_breaks (employee_id, work_date, break_min) VALUES ($1,$2,$3)
           ON CONFLICT (employee_id, work_date) DO UPDATE SET break_min=EXCLUDED.break_min`, [emp.id, date, m]);
  if (oldV !== m) await log({ employee_id: emp.id, work_date: date }, 'break', `${oldV}`, `${m}`, reason);
}

export const history = (employeeId, date) =>
  q(`SELECT * FROM shift_edits WHERE employee_id=$1 AND work_date=$2 ORDER BY changed_at DESC`, [employeeId, date]);

/** Shifts still open at the end of the working window, or from earlier days -> Needs review. */
export async function markReview(settings, now = new Date()) {
  const d = dateOf(now);
  const endReached = minutesOfDay(now) >= hmToMin(settings.window_end);
  return q(
    `UPDATE shifts SET status='review'
     WHERE status='open' AND (work_date < $1 OR ($2 AND work_date = $1)) RETURNING *`,
    [d, endReached],
  );
}

/** Items the owner should look at. */
export async function attention() {
  return q(
    `SELECT s.*, e.full_name FROM shifts s JOIN employees e ON e.id = s.employee_id
     WHERE s.needs_approval OR s.status='review' OR (s.out_of_window AND s.work_date = $1::date)
     ORDER BY s.work_date DESC, s.check_in DESC`, [today()],
  );
}
